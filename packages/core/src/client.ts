import { gotrueToken, readMachineToken, readSession, storeSession } from "./auth.js";
import { loadGlobalConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { fetchWithTimeout } from "./http.js";
import type { components } from "./generated/schema.js";

type Schemas = components["schemas"];
export type SearchRequest = Schemas["SearchRequest"];
export type SearchResponse = Schemas["SearchResponse"];
export type SearchResult = Schemas["SearchResult"];
export type SourceSelector = Schemas["SourceSelector"];
export type SourceOut = Schemas["SourceOut"];
export type VersionsOut = Schemas["VersionsOut"];
export type DocWindowOut = Schemas["DocWindowOut"];
export type ReportIn = Schemas["ReportIn"];
export type ReportOut = Schemas["ReportOut"];
export type SubmissionIn = Schemas["SubmissionIn"];
export type SubmitAccepted = Schemas["SubmitAccepted"];
export type JobOut = Schemas["JobOut"];
export type MeOut = Schemas["MeOut"];
export type UserGrantOut = Schemas["UserGrantOut"];
export type TokenMinted = Schemas["TokenMinted"];

export { ApiError } from "./errors.js";

export interface ClientOptions {
  baseUrl?: string;
  machineToken?: string;
}

const CODES: Record<number, string> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  422: "invalid_request",
  429: "quota_exceeded",
};

export class GrimoireClient {
  private readonly baseUrl: string;
  private readonly machineToken?: string;
  private cachedAccessToken?: { token: string; expiresAt: number };
  private refreshInFlight?: Promise<string>;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? loadGlobalConfig().apiBaseUrl).replace(/\/+$/, "");
    this.machineToken = opts.machineToken ?? process.env.GRIMOIRE_AUTH_TOKEN ?? readMachineToken();
  }

  private async bearer(): Promise<string> {
    if (this.machineToken) return this.machineToken;
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now() + 60_000) {
      return this.cachedAccessToken.token;
    }
    this.refreshInFlight ??= this.refreshAccessToken().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  // Exchange the stored refresh token for a fresh access token. GoTrue rotates
  // refresh tokens, so the new one replaces the stored one every time.
  private async refreshAccessToken(): Promise<string> {
    const session = readSession();
    if (!session) throw new ApiError(401, "not_logged_in", "Run `grimoire login`");
    let tokens;
    try {
      tokens = await gotrueToken(session.supabase_url, session.supabase_anon_key, "refresh_token", {
        refresh_token: session.refresh_token,
      });
    } catch (err) {
      if (err instanceof ApiError) throw new ApiError(err.status, "refresh_failed", "Run `grimoire login`");
      throw err;
    }
    storeSession({ ...session, refresh_token: tokens.refresh_token });
    this.cachedAccessToken = {
      token: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    return tokens.access_token;
  }

  async refreshSession(): Promise<void> {
    await this.bearer();
  }

  private async send(path: string, init: RequestInit, auth: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    };
    if (auth) headers.Authorization = `Bearer ${await this.bearer()}`;
    return fetchWithTimeout(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    let res = await this.send(path, init, auth);
    // A 401 despite a locally-unexpired access token means it was revoked
    // server-side: force one refresh and retry exactly once.
    if (res.status === 401 && auth && !this.machineToken) {
      this.cachedAccessToken = undefined;
      res = await this.send(path, init, auth);
    }
    return this.parseResponse<T>(res);
  }

  // FastAPI errors carry {"detail": "..."} (string) or {"detail": [...]} (422).
  private async parseResponse<T>(res: Response): Promise<T> {
    const isJson = res.headers.get("content-type")?.includes("json") ?? false;
    const text = await res.text();
    let body: unknown;
    let parsed = false;
    if (isJson && text) {
      try {
        body = JSON.parse(text);
        parsed = true;
      } catch {
        parsed = false;
      }
    }
    if (!res.ok) {
      const detail =
        parsed && typeof body === "object" && body !== null ? (body as { detail?: unknown }).detail : undefined;
      throw new ApiError(res.status, CODES[res.status] ?? "error", detail ?? (parsed ? body : text));
    }
    if (isJson) return (parsed ? body : {}) as T;
    return text as unknown as T;
  }

  search(input: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>("/v1/search", { method: "POST", body: JSON.stringify(input) });
  }

  listSources(): Promise<SourceOut[]> {
    return this.request<SourceOut[]>("/v1/sources");
  }

  listVersions(product: string): Promise<VersionsOut> {
    return this.request<VersionsOut>(`/v1/sources/${encodeURIComponent(product)}/versions`);
  }

  getDoc(pointId: string, window = 2): Promise<DocWindowOut> {
    return this.request<DocWindowOut>(`/v1/doc/${encodeURIComponent(pointId)}?window=${window}`);
  }

  reportResult(pointId: string, verdict: ReportIn["verdict"], note?: string): Promise<ReportOut> {
    const body: ReportIn = { point_id: pointId, verdict, ...(note ? { note } : {}) };
    return this.request<ReportOut>("/v1/report", { method: "POST", body: JSON.stringify(body) });
  }

  submitSource(body: SubmissionIn): Promise<SubmitAccepted> {
    return this.request<SubmitAccepted>("/v1/sources", { method: "POST", body: JSON.stringify(body) });
  }

  getJob(jobId: string): Promise<JobOut> {
    return this.request<JobOut>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  me(): Promise<MeOut> {
    return this.request<MeOut>("/v1/me");
  }

  reviewQueue(): Promise<JobOut[]> {
    return this.request<JobOut[]>("/v1/staff/review-queue");
  }

  approveJob(jobId: string): Promise<JobOut> {
    return this.request<JobOut>(`/v1/staff/jobs/${encodeURIComponent(jobId)}/approve`, { method: "POST" });
  }

  listUsers(): Promise<UserGrantOut[]> {
    return this.request<UserGrantOut[]>("/v1/staff/users");
  }

  grantUser(subject: string, name: string): Promise<UserGrantOut> {
    return this.request<UserGrantOut>("/v1/staff/users", {
      method: "POST",
      body: JSON.stringify({ subject, name }),
    });
  }

  revokeUser(subject: string): Promise<UserGrantOut> {
    return this.request<UserGrantOut>(`/v1/staff/users/${encodeURIComponent(subject)}`, { method: "DELETE" });
  }

  mintToken(name: string, quotaPerDay: number): Promise<TokenMinted> {
    return this.request<TokenMinted>("/v1/staff/tokens", {
      method: "POST",
      body: JSON.stringify({ name, quota_per_day: quotaPerDay }),
    });
  }

  recrawlSource(sourceId: string): Promise<JobOut> {
    return this.request<JobOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}/recrawl`, { method: "POST" });
  }

  rejectJob(jobId: string, reason: string): Promise<JobOut> {
    return this.request<JobOut>(`/v1/staff/jobs/${encodeURIComponent(jobId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }
}
