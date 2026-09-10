import { gotrueToken, readMachineToken, readSession, storeSession, tokenClaims } from "./auth.js";
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
export type WorkerOut = Schemas["WorkerOut"];
export type MeOut = Schemas["MeOut"];
export type UserGrantOut = Schemas["UserGrantOut"];
export type TokenMinted = Schemas["TokenMinted"];
export type SourceDetailOut = Schemas["SourceDetailOut"];
export type SourceScopeIn = Schemas["SourceScopeIn"];
export type PurgeOut = Schemas["PurgeOut"];
export type FrontierUrlOut = Schemas["FrontierUrlOut"];
export type SourceCreateIn = Schemas["SourceCreateIn"];
export type PageUploadOut = Schemas["PageUploadOut"];

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

  // The login email from the session token; undefined for machine tokens.
  /** The account's Supabase subject, readable before any grant exists. */
  async sessionSubject(): Promise<string | undefined> {
    const claims = tokenClaims(await this.bearer());
    return typeof claims.sub === "string" ? claims.sub : undefined;
  }

  async sessionEmail(): Promise<string | undefined> {
    if (this.machineToken) return undefined;
    const email = tokenClaims(await this.bearer()).email;
    return typeof email === "string" ? email : undefined;
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

  grantUser(subject: string, name: string, staff = false): Promise<UserGrantOut> {
    return this.request<UserGrantOut>("/v1/staff/users", {
      method: "POST",
      body: JSON.stringify({ subject, name, staff }),
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

  recrawlSource(sourceId: string, opts: { failedOnly?: boolean } = {}): Promise<JobOut> {
    const query = opts.failedOnly ? "?failed_only=true" : "";
    return this.request<JobOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}/recrawl${query}`, {
      method: "POST",
    });
  }

  listFrontier(sourceId: string, filter: { status?: string; limit?: number } = {}): Promise<FrontierUrlOut[]> {
    const params = new URLSearchParams();
    if (filter.status) params.set("status", filter.status);
    if (filter.limit !== undefined) params.set("limit", String(filter.limit));
    const query = params.toString();
    return this.request<FrontierUrlOut[]>(
      `/v1/staff/sources/${encodeURIComponent(sourceId)}/frontier${query ? `?${query}` : ""}`,
    );
  }

  createUploadSource(body: SourceCreateIn): Promise<SourceDetailOut> {
    return this.request<SourceDetailOut>("/v1/staff/sources", { method: "POST", body: JSON.stringify(body) });
  }

  uploadPage(sourceId: string, url: string, html: string): Promise<PageUploadOut> {
    return this.request<PageUploadOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}/pages`, {
      method: "PUT",
      body: JSON.stringify({ url, html }),
    });
  }

  reindexSource(sourceId: string, opts: { urgent?: boolean } = {}): Promise<JobOut> {
    const query = opts.urgent ? "?urgent=true" : "";
    return this.request<JobOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}/reindex${query}`, {
      method: "POST",
    });
  }

  sourceDetail(sourceId: string): Promise<SourceDetailOut> {
    return this.request<SourceDetailOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}`);
  }

  editSource(sourceId: string, body: SourceScopeIn): Promise<SourceDetailOut> {
    return this.request<SourceDetailOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  purgeSource(sourceId: string): Promise<PurgeOut> {
    return this.request<PurgeOut>(`/v1/staff/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
  }

  listWorkers(): Promise<WorkerOut[]> {
    return this.request<WorkerOut[]>("/v1/staff/workers");
  }

  listJobs(filter: { sourceId?: string; state?: string; kind?: string; limit?: number }): Promise<JobOut[]> {
    const params = new URLSearchParams();
    if (filter.sourceId) params.set("source_id", filter.sourceId);
    if (filter.state) params.set("state", filter.state);
    if (filter.kind) params.set("kind", filter.kind);
    if (filter.limit !== undefined) params.set("limit", String(filter.limit));
    const query = params.toString();
    return this.request<JobOut[]>(`/v1/staff/jobs${query ? `?${query}` : ""}`);
  }

  cancelJob(jobId: string): Promise<JobOut> {
    return this.request<JobOut>(`/v1/staff/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  }

  rejectJob(jobId: string, reason: string): Promise<JobOut> {
    return this.request<JobOut>(`/v1/staff/jobs/${encodeURIComponent(jobId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }
}
