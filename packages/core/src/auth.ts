import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Entry } from "@napi-rs/keyring";
import { fetchWithTimeout } from "./http.js";

// Credential storage in the OS keychain (maintained @napi-rs/keyring — keytar is
// archived). A machine token via GRIMOIRE_AUTH_TOKEN overrides interactive auth (CI only).
const SERVICE = "com.monadeo.grimoire";
const ACCOUNT = "refresh_token";

function keyring(): Entry {
  return new Entry(SERVICE, ACCOUNT);
}

export function storeRefreshToken(token: string): void {
  keyring().setPassword(token);
}

export function readRefreshToken(): string | undefined {
  try {
    return keyring().getPassword() ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearRefreshToken(): void {
  try {
    keyring().deletePassword();
  } catch {
    /* already gone */
  }
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
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>Login complete — return to your terminal.</p>");
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
  const { refresh_token } = (await res.json()) as { refresh_token: string };
  storeRefreshToken(refresh_token);
}
