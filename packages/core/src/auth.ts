import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Entry } from "@napi-rs/keyring";

// Credential storage in the OS keychain (maintained @napi-rs/keyring — keytar is
// archived). A machine token via AUTH_TOKEN overrides interactive auth (CI only).
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
// callback, exchange it for the Firebase refresh token.
export async function browserLogin(apiBase: string, openBrowser: (url: string) => void): Promise<void> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const received = url.searchParams.get("code");
      res.writeHead(received ? 200 : 400, { "Content-Type": "text/html" });
      res.end(received ? "<p>Login complete — return to your terminal.</p>" : "<p>Missing code.</p>");
      server.close();
      if (received) resolve(received);
      else reject(new Error("No code in callback"));
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      openBrowser(
        `${apiBase}/auth/cli/start?code_challenge=${challenge}&redirect_uri=${encodeURIComponent(redirect)}`,
      );
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out"));
    }, 300_000);
  });

  const res = await fetch(`${apiBase}/auth/cli/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const { refresh_token } = (await res.json()) as { refresh_token: string };
  storeRefreshToken(refresh_token);
}
