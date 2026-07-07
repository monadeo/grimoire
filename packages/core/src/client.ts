import { readRefreshToken } from "./auth.js";
import { loadGlobalConfig } from "./config.js";

export interface SearchResultChunk {
  chunk_id: string;
  source: string;
  version: string;
  ingested_at: string;
  score: number;
  heading_path: string[];
  text: string;
  token_count: number;
  origin_url: string;
}

export interface SearchResponse {
  results: SearchResultChunk[];
  confidence: "strong" | "weak";
  reranked: boolean;
  resolved_versions: Record<string, string>;
  usage: { retrievals_remaining: number | null };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
  ) {
    super(`${code} (${status})`);
  }
}

export interface ClientOptions {
  baseUrl?: string;
  machineToken?: string;
}

export class GrimoireClient {
  private readonly baseUrl: string;
  private readonly machineToken?: string;
  private cachedIdToken?: { token: string; expiresAt: number };

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? loadGlobalConfig().apiBaseUrl;
    this.machineToken = opts.machineToken ?? process.env.AUTH_TOKEN;
  }

  private async bearer(): Promise<string> {
    if (this.machineToken) return this.machineToken;
    if (this.cachedIdToken && this.cachedIdToken.expiresAt > Date.now() + 60_000) {
      return this.cachedIdToken.token;
    }
    const refresh = readRefreshToken();
    if (!refresh) throw new ApiError(401, "not_logged_in", "Run `grimoire login`");
    // Exchange the Firebase refresh token for a fresh ID token (silent refresh).
    const res = await fetch(`${this.baseUrl}/auth/cli/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) throw new ApiError(res.status, "refresh_failed", "Run `grimoire login`");
    const { id_token, expires_in } = (await res.json()) as { id_token: string; expires_in: number };
    this.cachedIdToken = { token: id_token, expiresAt: Date.now() + expires_in * 1000 };
    return id_token;
  }

  private async request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    };
    if (auth) headers.Authorization = `Bearer ${await this.bearer()}`;
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const body: unknown = res.headers.get("content-type")?.includes("json")
      ? await res.json()
      : await res.text();
    if (!res.ok) {
      const code = (body as { error?: string }).error ?? "error";
      throw new ApiError(res.status, code, body);
    }
    return body as T;
  }

  search(input: {
    query: string;
    sources: { source: string; version?: string }[];
    language?: string;
    top_k?: number;
    max_response_tokens?: number;
  }): Promise<SearchResponse> {
    return this.request<SearchResponse>("/search", { method: "POST", body: JSON.stringify(input) });
  }

  listSources(q?: string): Promise<{ sources: unknown[] }> {
    return this.request(`/sources${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  listVersions(sourceId: string): Promise<{ versions: unknown[] }> {
    return this.request(`/sources/${encodeURIComponent(sourceId)}/versions`);
  }

  getContext(chunkId: string, window = 2): Promise<{ chunks: unknown[] }> {
    return this.request(`/documents/${encodeURIComponent(chunkId)}/context?window=${window}`);
  }

  reportResult(chunkId: string, verdict: string, note?: string): Promise<unknown> {
    return this.request("/feedback", {
      method: "POST",
      body: JSON.stringify({ chunk_id: chunkId, verdict, note }),
    });
  }

  submitSource(body: Record<string, unknown>): Promise<{ job_id: string }> {
    return this.request("/sources", { method: "POST", body: JSON.stringify(body) });
  }

  getJob(jobId: string): Promise<{ status: string; counters: Record<string, number> }> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}`);
  }
}
