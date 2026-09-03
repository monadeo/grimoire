import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAuthConfig, gotrueToken, passwordLogin, readSession } from "./auth.js";
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchAuthConfig", () => {
  it("reads the public Supabase parameters from the API", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.test/v1/auth/config");
      return jsonResponse(200, { supabase_url: "https://sb.test", supabase_anon_key: "anon" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAuthConfig("https://api.test/")).toEqual({ supabase_url: "https://sb.test", supabase_anon_key: "anon" });
  });

  it("rejects a malformed payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { nope: true })));
    await expect(fetchAuthConfig("https://api.test")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("gotrueToken", () => {
  it("posts the grant with the anon key header", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://sb.test/auth/v1/token?grant_type=password");
      expect((init?.headers as Record<string, string>).apikey).toBe("anon");
      expect(JSON.parse(String(init?.body))).toEqual({ email: "a@b.c", password: "pw" });
      return jsonResponse(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokens = await gotrueToken("https://sb.test", "anon", "password", { email: "a@b.c", password: "pw" });
    expect(tokens).toEqual({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
  });

  it("maps a rejected grant to login_failed with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "invalid_grant", error_description: "Invalid login credentials" })),
    );
    const err = await gotrueToken("https://sb.test", "anon", "password", { email: "a", password: "b" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("login_failed");
    expect((err as ApiError).status).toBe(400);
  });
});

describe("passwordLogin", () => {
  it("stores the session with the Supabase parameters, mode 0600", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith("/v1/auth/config")
          ? jsonResponse(200, { supabase_url: "https://sb.test", supabase_anon_key: "anon" })
          : jsonResponse(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      ),
    );
    await passwordLogin("https://api.test", "a@b.c", "pw");
    expect(readSession()).toEqual({ refresh_token: "rt", supabase_url: "https://sb.test", supabase_anon_key: "anon" });
    const path = join(dir, "grimoire", "credentials.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).refresh_token).toBe("rt");
  });
});
