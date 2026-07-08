import { readRefreshToken } from "./auth.js";
import { loadGlobalConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { fetchWithTimeout } from "./http.js";
import type { components, operations } from "./generated/schema.js";

export type SearchResultChunk = components["schemas"]["Chunk"];
export type SourceCard = components["schemas"]["SourceCard"];
export type ContextChunk = components["schemas"]["ContextChunk"];
export type SearchRequest = operations["search"]["requestBody"]["content"]["application/json"];
export type SearchResponse = operations["search"]["responses"][200]["content"]["application/json"];
export type ListSourcesResponse =
  operations["listSources"]["responses"][200]["content"]["application/json"];
export type ListVersionsResponse =
  operations["listVersions"]["responses"][200]["content"]["application/json"];
export type ContextResponse =
  operations["getDocumentContext"]["responses"][200]["content"]["application/json"];

export type Job = components["schemas"]["Job"];
export type SubmitSourceResponse =
  operations["submitSource"]["responses"][201]["content"]["application/json"];

export { ApiError } from "./errors.js";

export interface ClientOptions {
  baseUrl?: string;
  machineToken?: string;
}

export class GrimoireClient {
  private readonly baseUrl: string;
  private readonly machineToken?: string;
  private cachedIdToken?: { token: string; expiresAt: number };
  private refreshInFlight?: Promise<string>;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? loadGlobalConfig().apiBaseUrl).replace(/\/+$/, "");
    this.machineToken = opts.machineToken ?? process.env.GRIMOIRE_AUTH_TOKEN;
  }

  private async bearer(): Promise<string> {
    if (this.machineToken) return this.machineToken;
    if (this.cachedIdToken && this.cachedIdToken.expiresAt > Date.now() + 60_000) {
      return this.cachedIdToken.token;
    }
    this.refreshInFlight ??= this.refreshIdToken().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  // Exchange the Firebase refresh token for a fresh ID token (silent refresh).
  private async refreshIdToken(): Promise<string> {
    const refresh = readRefreshToken();
    if (!refresh) throw new ApiError(401, "not_logged_in", "Run `grimoire login`");
    const res = await fetchWithTimeout(`${this.baseUrl}/auth/cli/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) throw new ApiError(res.status, "refresh_failed", "Run `grimoire login`");
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new ApiError(res.status, "refresh_failed", "Malformed refresh response");
    }
    const { id_token, expires_in } = payload as { id_token?: unknown; expires_in?: unknown };
    if (typeof id_token !== "string" || typeof expires_in !== "number") {
      throw new ApiError(res.status, "refresh_failed", "Malformed refresh response");
    }
    this.cachedIdToken = { token: id_token, expiresAt: Date.now() + expires_in * 1000 };
    return id_token;
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
    // A 401 despite a locally-unexpired ID token means it was revoked server-side:
    // force one refresh and retry exactly once.
    if (res.status === 401 && auth && !this.machineToken) {
      this.cachedIdToken = undefined;
      res = await this.send(path, init, auth);
    }
    return this.parseResponse<T>(res);
  }

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
      const code =
        parsed && typeof body === "object" && body !== null
          ? ((body as { error?: string }).error ?? "error")
          : "error";
      throw new ApiError(res.status, code, parsed ? body : text);
    }
    if (isJson) return (parsed ? body : {}) as T;
    return text as unknown as T;
  }

  search(input: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>("/v1/search", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listSources(q?: string): Promise<ListSourcesResponse> {
    return this.request(`/v1/sources${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  listVersions(sourceId: string): Promise<ListVersionsResponse> {
    return this.request(`/v1/sources/${encodeURIComponent(sourceId)}/versions`);
  }

  getContext(chunkId: string, window = 2): Promise<ContextResponse> {
    return this.request(`/v1/documents/${encodeURIComponent(chunkId)}/context?window=${window}`);
  }

  reportResult(chunkId: string, verdict: string, note?: string): Promise<unknown> {
    return this.request("/v1/feedback", {
      method: "POST",
      body: JSON.stringify({ chunk_id: chunkId, verdict, note }),
    });
  }

  submitSource(body: Record<string, unknown>): Promise<SubmitSourceResponse> {
    return this.request("/v1/sources", { method: "POST", body: JSON.stringify(body) });
  }

  getJob(jobId: string): Promise<Job> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }
}
