import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ApiError } from "./errors.js";
import { fetchWithTimeout } from "./http.js";

// Session storage is a 0600 file, not the OS keychain (Astro 2026-07-14):
// keychain ACLs are per binary, so every agent runtime spawning the MCP server
// re-prompted the user — gcloud and Codex accept the same file-based model.
// A machine token via GRIMOIRE_AUTH_TOKEN overrides interactive auth (CI only).
export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "grimoire");
}

function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

// The refresh token alone cannot be exchanged: GoTrue needs the project URL and
// its anon key, so the login stores all three together.
export interface StoredSession {
  refresh_token: string;
  supabase_url: string;
  supabase_anon_key: string;
}

export function storeSession(session: StoredSession): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(session) + "\n", { mode: 0o600 });
}

export function readSession(): StoredSession | undefined {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), "utf8")) as Partial<StoredSession>;
    if (
      typeof parsed.refresh_token === "string" &&
      parsed.refresh_token !== "" &&
      typeof parsed.supabase_url === "string" &&
      typeof parsed.supabase_anon_key === "string"
    ) {
      return {
        refresh_token: parsed.refresh_token,
        supabase_url: parsed.supabase_url,
        supabase_anon_key: parsed.supabase_anon_key,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function clearSession(): void {
  if (existsSync(credentialsPath())) rmSync(credentialsPath());
}

// Persisted machine token, for users who want a `mt_` token without exporting
// GRIMOIRE_AUTH_TOKEN in a shell profile (that env var still overrides). Same
// 0600 model as credentials.json — never the world-readable config.json.
function machineTokenPath(): string {
  return join(configDir(), "machine-token");
}

export function storeMachineToken(token: string): void {
  const path = machineTokenPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, token + "\n", { mode: 0o600 });
}

export function readMachineToken(): string | undefined {
  try {
    const token = readFileSync(machineTokenPath(), "utf8").trim();
    return token !== "" ? token : undefined;
  } catch {
    return undefined;
  }
}

export function clearMachineToken(): void {
  if (existsSync(machineTokenPath())) rmSync(machineTokenPath());
}

export interface AuthConfig {
  supabase_url: string;
  supabase_anon_key: string;
  oauth_provider: string;
  redirect_urls: string[];
  /** Absent on servers older than 0.10.2. */
  server_version?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// The API publishes everything a client needs to log in: the public Supabase
// URL, its anon key (public by design), the OAuth provider, and the loopback
// callbacks that are allow-listed for the PKCE flow.
export async function fetchAuthConfig(apiBase: string): Promise<AuthConfig> {
  const res = await fetchWithTimeout(`${apiBase.replace(/\/+$/, "")}/v1/auth/config`);
  if (!res.ok) throw new ApiError(res.status, "auth_config_unavailable", await res.text());
  const body = (await res.json()) as Partial<AuthConfig>;
  if (
    typeof body.supabase_url !== "string" ||
    typeof body.supabase_anon_key !== "string" ||
    typeof body.oauth_provider !== "string" ||
    !Array.isArray(body.redirect_urls) ||
    body.redirect_urls.length === 0
  ) {
    throw new ApiError(res.status, "auth_config_malformed", body);
  }
  return {
    supabase_url: body.supabase_url,
    supabase_anon_key: body.supabase_anon_key,
    oauth_provider: body.oauth_provider,
    redirect_urls: body.redirect_urls.map(String),
    server_version: typeof body.server_version === "string" ? body.server_version : undefined,
  };
}

type GrantType = "pkce" | "refresh_token";

function parseDetail(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Supabase Auth (GoTrue) token endpoint: POST /auth/v1/token?grant_type=…, the
// anon key in the apikey header, JSON body per grant.
export async function gotrueToken(
  supabaseUrl: string,
  anonKey: string,
  grantType: GrantType,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetchWithTimeout(
    `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=${grantType}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, grantType === "pkce" ? "login_failed" : "refresh_failed", parseDetail(text));
  }
  const parsed = JSON.parse(text) as Partial<TokenResponse>;
  if (
    typeof parsed.access_token !== "string" ||
    typeof parsed.refresh_token !== "string" ||
    typeof parsed.expires_in !== "number"
  ) {
    throw new ApiError(res.status, "token_malformed", parsed);
  }
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expires_in: parsed.expires_in,
  };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// Bind the first free allow-listed loopback callback (IPv4). The bases come
// from the API, so the client and the Supabase allow list cannot drift.
async function bindCallback(server: Server, redirectUrls: string[]): Promise<string> {
  for (const candidate of redirectUrls) {
    const port = Number(new URL(candidate).port);
    const bound = await new Promise<boolean>((resolve) => {
      const onError = (): void => {
        server.off("error", onError);
        resolve(false);
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        resolve(true);
      });
    });
    if (bound) return candidate;
  }
  throw new Error(`No free login callback port among: ${redirectUrls.join(", ")}`);
}

// OAuth Authorization Code with PKCE through Supabase Auth: open the provider
// login in the browser, receive the code on a loopback callback, exchange code +
// verifier for tokens. No client secret exists anywhere in the client.
//
// Supabase Auth's /authorize carries no `state` parameter, so the per-attempt
// state rides in the callback path (`/callback/<state>`); any other path is a
// 404 and the server keeps waiting. The allow list holds `/callback/*`.
export async function browserLogin(
  apiBase: string,
  openBrowser: (url: string) => void,
  timeoutMs = 300_000,
): Promise<void> {
  const config = await fetchAuthConfig(apiBase);
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const code = await new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (outcome: { code: string } | { error: Error }): void => {
      if (timer) clearTimeout(timer);
      server.closeAllConnections();
      server.close();
      if ("code" in outcome) resolve(outcome.code);
      else reject(outcome.error);
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== `/callback/${state}`) {
        res.writeHead(404).end();
        return;
      }
      const failure = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      const received = url.searchParams.get("code");
      if (failure || !received) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end(`Login failed: ${failure ?? "no code"}`);
        finish({ error: new Error(`Login failed: ${failure ?? "no code returned"}`) });
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/plain" })
        .end("Logged in to Grimoire. You can close this tab.");
      finish({ code: received });
    });
    bindCallback(server, config.redirect_urls)
      .then((redirectBase) => {
        timer = setTimeout(() => finish({ error: new Error("Login timed out") }), timeoutMs);
        const authorize = new URL(`${config.supabase_url.replace(/\/+$/, "")}/auth/v1/authorize`);
        authorize.searchParams.set("provider", config.oauth_provider);
        authorize.searchParams.set("redirect_to", `${redirectBase.replace(/\/+$/, "")}/${state}`);
        authorize.searchParams.set("code_challenge", challenge);
        authorize.searchParams.set("code_challenge_method", "s256");
        openBrowser(authorize.toString());
      })
      .catch((err: Error) => finish({ error: err }));
  });

  const tokens = await gotrueToken(config.supabase_url, config.supabase_anon_key, "pkce", {
    auth_code: code,
    code_verifier: verifier,
  });
  storeSession({
    refresh_token: tokens.refresh_token,
    supabase_url: config.supabase_url,
    supabase_anon_key: config.supabase_anon_key,
  });
}


// Claims of an access token, read without verification — for display only
// (the API verifies every token it receives).
export function tokenClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
