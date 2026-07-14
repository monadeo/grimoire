import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fetchWithTimeout } from "./http.js";

// Session storage is a 0600 file, not the OS keychain (Astro 2026-07-14):
// keychain ACLs are per binary, so every agent runtime spawning the MCP server
// re-prompted the user — gcloud and Codex accept the same file-based model.
// A machine token via GRIMOIRE_AUTH_TOKEN overrides interactive auth (CI only).
function credentialsPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "grimoire",
    "credentials.json",
  );
}

export function storeRefreshToken(token: string): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ refresh_token: token }) + "\n", { mode: 0o600 });
}

export function readRefreshToken(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), "utf8")) as {
      refresh_token?: unknown;
    };
    return typeof parsed.refresh_token === "string" && parsed.refresh_token !== ""
      ? parsed.refresh_token
      : undefined;
  } catch {
    return undefined;
  }
}

export function clearRefreshToken(): void {
  if (existsSync(credentialsPath())) rmSync(credentialsPath());
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// Browser login via the Grimoire auth broker (Firebase is not an OAuth AS): open
// the hosted page with a PKCE challenge, receive the one-time code on a loopback
// callback, exchange it for the Firebase refresh token. The random state binds the
// callback to this login attempt; anything but GET /callback with that state gets
// a 404 and the server keeps waiting.
export async function browserLogin(apiBase: string, openBrowser: (url: string) => void): Promise<void> {
  // The broker lives at the bare origin (/auth/cli/*, no /v1 prefix): normalize
  // away trailing slashes so the URLs are always built against the origin.
  const broker = apiBase.replace(/\/+$/, "");
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const received = url.searchParams.get("code");
      if (
        req.method !== "GET" ||
        url.pathname !== "/callback" ||
        url.searchParams.get("state") !== state ||
        !received
      ) {
        res.writeHead(404).end();
        return;
      }
      // Land the user on the hosted branded page rather than raw loopback text.
      res.writeHead(302, { Location: `${broker}/auth/cli/success` }).end();
      clearTimeout(timer);
      server.close();
      resolve(received);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      openBrowser(
        `${broker}/auth/cli/start?code_challenge=${challenge}&code_challenge_method=S256&state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
      );
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out"));
    }, 300_000);
  });

  const res = await fetchWithTimeout(`${broker}/auth/cli/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const { refresh_token } = (await res.json()) as { refresh_token?: unknown };
  if (typeof refresh_token !== "string" || refresh_token.length === 0) {
    throw new Error("Token exchange succeeded but returned no refresh token");
  }
  storeRefreshToken(refresh_token);
}
