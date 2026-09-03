import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserLogin, fetchAuthConfig, gotrueToken, readSession } from "./auth.js";
import { ApiError } from "./errors.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grimauth-"));
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const CONFIG = {
  supabase_url: "https://sb.test",
  supabase_anon_key: "anon",
  oauth_provider: "custom:zitadel",
  redirect_urls: ["http://localhost:53682/callback", "http://localhost:53683/callback"],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hit(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject);
  });
}

describe("fetchAuthConfig", () => {
  it("reads the public login parameters from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toBe("https://api.test/v1/auth/config");
        return jsonResponse(200, CONFIG);
      }),
    );
    expect(await fetchAuthConfig("https://api.test/")).toEqual(CONFIG);
  });

  it("rejects a payload without callbacks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ...CONFIG, redirect_urls: [] })));
    await expect(fetchAuthConfig("https://api.test")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("gotrueToken", () => {
  it("maps a rejected refresh to refresh_failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: "invalid_grant" })));
    const err = await gotrueToken("https://sb.test", "anon", "refresh_token", { refresh_token: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("refresh_failed");
  });
});

describe("browserLogin (PKCE)", () => {
  it("opens the authorize URL, receives the code on loopback, exchanges it, stores the session", async () => {
    const exchanges: Record<string, string>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/v1/auth/config")) return jsonResponse(200, CONFIG);
        expect(target).toBe("https://sb.test/auth/v1/token?grant_type=pkce");
        expect((init?.headers as Record<string, string>).apikey).toBe("anon");
        exchanges.push(JSON.parse(String(init?.body)) as Record<string, string>);
        return jsonResponse(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 });
      }),
    );

    let authorizeUrl = "";
    const openBrowser = (url: string): void => {
      authorizeUrl = url;
      const parsed = new URL(url);
      const callback = parsed.searchParams.get("redirect_to") ?? "";
      void hit(`${callback}?code=the-code`);
    };

    await browserLogin("https://api.test", openBrowser, 10_000);

    const parsed = new URL(authorizeUrl);
    expect(parsed.origin + parsed.pathname).toBe("https://sb.test/auth/v1/authorize");
    expect(parsed.searchParams.get("provider")).toBe("custom:zitadel");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("s256");
    expect(CONFIG.redirect_urls).toContain(parsed.searchParams.get("redirect_to"));

    expect(exchanges).toHaveLength(1);
    const { auth_code, code_verifier } = exchanges[0];
    expect(auth_code).toBe("the-code");
    const expectedChallenge = createHash("sha256").update(code_verifier).digest("base64url");
    expect(parsed.searchParams.get("code_challenge")).toBe(expectedChallenge);

    expect(readSession()).toEqual({ refresh_token: "rt", supabase_url: "https://sb.test", supabase_anon_key: "anon" });
    expect(statSync(join(dir, "grimoire", "credentials.json")).mode & 0o777).toBe(0o600);
  });

  it("fails when the provider returns an error on the callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, CONFIG)));
    const openBrowser = (url: string): void => {
      const callback = new URL(url).searchParams.get("redirect_to") ?? "";
      void hit(`${callback}?error=access_denied&error_description=denied`);
    };
    await expect(browserLogin("https://api.test", openBrowser, 10_000)).rejects.toThrow(/denied/);
    expect(readSession()).toBeUndefined();
  });
});
