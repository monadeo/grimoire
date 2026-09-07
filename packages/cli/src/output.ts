import type { ApiError, SearchResponse, SearchResult } from "@monadeo.com/grimoire-core";

// Exit codes documented for scripting (clients spec).
export const EXIT = { ok: 0, apiError: 1, authRequired: 2, quota: 3, notFound: 4 } as const;

// The API labels result text as untrusted data; the CLI repeats that on stderr
// so agents reading stdout never see it as an instruction.
/** Where the time went, on stderr, so stdout stays the answer. */
export function printTimings(res: SearchResponse): void {
  const t = res.timings;
  if (!t) {
    process.stderr.write(`timings: total ${res.latency_ms} ms (server older than 0.21.0 reports no stages)\n`);
    return;
  }
  process.stderr.write(
    `timings: embed ${t.embed_ms} ms · retrieve ${t.retrieve_ms} ms · rerank ${t.rerank_ms} ms (${res.reranker ?? "local"}) · stitch ${t.stitch_ms} ms · total ${t.total_ms} ms\n`,
  );
}

function preamble(res: SearchResponse): void {
  const versions = Object.entries(res.resolved_versions)
    .map(([product, version]) => `${product}@${version}`)
    .join(", ");
  process.stderr.write(`sources: ${versions} · retrievals remaining: ${res.retrievals_remaining}\n`);
  process.stderr.write(`note: ${res.untrusted_content_notice}\n`);
  if (res.results.length === 0) {
    process.stderr.write("note: no result passed the relevance threshold — the docs may not cover this.\n");
  }
}

function heading(r: SearchResult): string {
  return r.heading_path.join(" › ");
}

export function printResults(res: SearchResponse): void {
  preamble(res);
  for (const r of res.results) {
    process.stdout.write(
      `\n${r.score.toFixed(3)}  ${r.product}@${r.version}  ${heading(r)}\n${r.source_url}\npoint_id: ${r.point_id}\n`,
    );
    const preview = r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text;
    process.stdout.write(`${preview}\n`);
  }
}

export function printCompact(res: SearchResponse): void {
  preamble(res);
  for (const r of res.results) {
    process.stdout.write(
      `${r.score.toFixed(3)} | ${r.product}@${r.version} | ${heading(r)} | ${r.source_url} | ${r.point_id}\n`,
    );
  }
}

// A proxy in front of the API answers an outage with an HTML page. Nobody
// wants that page in a terminal: name the status and, when the proxy says
// why, its one-line reason.
export function describeError(err: ApiError): string {
  if (typeof err.body === "string" && /^\s*<(!doctype|html)/i.test(err.body)) {
    const reason = /"statusText":"([^"]*)"/.exec(err.body)?.[1];
    return `error: the API is unreachable — the proxy answered HTTP ${err.status}${reason ? ` (${reason})` : ""}`;
  }
  const detail =
    typeof err.body === "string"
      ? err.body
      : err.body !== undefined && err.body !== null
        ? JSON.stringify(err.body)
        : "";
  return `error: ${err.code}${detail ? ` — ${detail}` : ""}`;
}
