import type { SearchResultChunk } from "@monadeo.com/grimoire-core";

// Exit codes documented for scripting (clients spec).
export const EXIT = { ok: 0, apiError: 1, authRequired: 2, quota: 3, notFound: 4 } as const;

function warnWeak(confidence: string): void {
  if (confidence === "weak") {
    process.stderr.write(
      "note: low-confidence results — the docs may not cover this; tell the user rather than guessing.\n",
    );
  }
}

export function printResults(results: SearchResultChunk[], confidence: string): void {
  warnWeak(confidence);
  for (const r of results) {
    const path = (r.heading_path ?? []).join(" › ");
    process.stdout.write(`\n${r.score.toFixed(3)}  ${r.source}@${r.version}  ${path}\n${r.origin_url}\n`);
    const preview = r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text;
    process.stdout.write(`${preview}\n`);
  }
}

// The weak-confidence note goes to stderr in compact mode too — SKILL.md steers
// agents to --compact, and the "don't guess" signal must survive that path.
export function printCompact(results: SearchResultChunk[], confidence: string): void {
  warnWeak(confidence);
  for (const r of results) {
    process.stdout.write(
      `${r.score.toFixed(3)} | ${r.source}@${r.version} | ${(r.heading_path ?? []).join(" › ")} | ${r.origin_url}\n`,
    );
  }
}
