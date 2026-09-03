import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ApiError } from "./errors.js";
import { fetchWithTimeout } from "./http.js";

// Session storage is a 0600 file, not the OS keychain (Astro 2026-07-14):
// keychain ACLs are per binary, so every agent runtime spawning the MCP server
// re-prompted the user — gcloud and Codex accept the same file-based model.
// A machine token via GRIMOIRE_AUTH_TOKEN overrides interactive auth (CI only).
function configDir(): string {
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
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// The API publishes the Supabase project URL and anon key (public by design), so
// a client only ever needs the API origin.
export async function fetchAuthConfig(apiBase: string): Promise<AuthConfig> {
  const res = await fetchWithTimeout(`${apiBase.replace(/\/+$/, "")}/v1/auth/config`);
  if (!res.ok) throw new ApiError(res.status, "auth_config_unavailable", await res.text());
  const body = (await res.json()) as Partial<AuthConfig>;
  if (typeof body.supabase_url !== "string" || typeof body.supabase_anon_key !== "string") {
    throw new ApiError(res.status, "auth_config_malformed", body);
  }
  return { supabase_url: body.supabase_url, supabase_anon_key: body.supabase_anon_key };
}

// Supabase Auth (GoTrue) token endpoint: POST /auth/v1/token?grant_type=…, the
// anon key in the apikey header, JSON body per grant.
export async function gotrueToken(
  supabaseUrl: string,
  anonKey: string,
  grantType: "password" | "refresh_token",
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
    throw new ApiError(res.status, grantType === "password" ? "login_failed" : "refresh_failed", parseDetail(text));
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

function parseDetail(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function passwordLogin(apiBase: string, email: string, password: string): Promise<void> {
  const config = await fetchAuthConfig(apiBase);
  const tokens = await gotrueToken(config.supabase_url, config.supabase_anon_key, "password", {
    email,
    password,
  });
  storeSession({
    refresh_token: tokens.refresh_token,
    supabase_url: config.supabase_url,
    supabase_anon_key: config.supabase_anon_key,
  });
}
