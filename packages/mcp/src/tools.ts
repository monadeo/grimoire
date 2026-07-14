import { z } from "zod";
import { GrimoireClient, resolveDefaultSources, loadGlobalConfig } from "@monadeo.com/grimoire-core";

const client = new GrimoireClient();

function sourcesFromArg(arg: unknown): { source: string; version?: string }[] {
  if (Array.isArray(arg)) {
    return arg.map((s) =>
      typeof s === "string"
        ? { source: s.split("@")[0], version: s.split("@")[1] }
        : (s as { source: string; version?: string }),
    );
  }
  return resolveDefaultSources();
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "search",
    description:
      "Query technical documentation. One concept per query — iterate with refined queries rather than raising top_k. Specify sources and versions; omit version for latest. If the response says confidence is weak, the documentation likely does not cover the topic — tell the user rather than guessing. Good: 'revalidateTag on-demand cache invalidation'. Bad (too broad): 'routing and auth and caching'.",
    schema: {
      query: z.string().describe("One documentation concept to look up"),
      sources: z
        .array(z.string())
        .optional()
        .describe("Source ids, optionally source@version; omit to use project defaults"),
      language: z.string().optional(),
      max_response_tokens: z.number().optional().describe("Cap response size to control context bloat"),
    },
    async handler(args) {
      const sources = sourcesFromArg(args.sources);
      // Guide the agent instead of surfacing the API's bare 400: this happens on
      // every search outside a configured project until it learns the pattern.
      if (sources.length === 0) {
        return "No sources specified and this project has no defaults. Call list_sources to discover what is indexed, then retry with sources: [\"<source_id>\"].";
      }
      const res = await client.search({
        query: String(args.query),
        sources,
        language: args.language as string | undefined,
        max_response_tokens:
          (args.max_response_tokens as number | undefined) ?? loadGlobalConfig().maxResponseTokens,
      });
      if (res.results.length === 0) return "No results. The documentation likely does not cover this.";
      const header =
        res.confidence === "weak"
          ? "CONFIDENCE: WEAK — the docs may not cover this; say so rather than guessing.\n\n"
          : "";
      return (
        header +
        res.results
          .map(
            (r) =>
              `## ${(r.heading_path ?? []).join(" › ")} (${r.source}@${r.version})\nSource: ${r.origin_url}\nchunk_id: ${r.chunk_id}\n\n${r.text}`,
          )
          .join("\n\n---\n\n")
      );
    },
  },
  {
    name: "fetch_document",
    description: "Expand context around a search hit by chunk id (neighbors in the same section).",
    schema: { chunk_id: z.string(), window: z.number().int().min(0).max(5).optional() },
    async handler(args) {
      const res = await client.getContext(String(args.chunk_id), (args.window as number) ?? 2);
      return JSON.stringify(res.chunks ?? [], null, 2);
    },
  },
  {
    name: "list_sources",
    description: "Discover indexed documentation sources; supports alias text search.",
    schema: { q: z.string().optional() },
    async handler(args) {
      return JSON.stringify((await client.listSources(args.q as string | undefined)).sources ?? [], null, 2);
    },
  },
  {
    name: "list_versions",
    description: "List indexed versions of a source.",
    schema: { source: z.string() },
    async handler(args) {
      return JSON.stringify((await client.listVersions(String(args.source))).versions ?? [], null, 2);
    },
  },
  {
    name: "report_result",
    description:
      "Report a retrieved chunk as helpful, incorrect, or outdated — use when documentation contradicted observed behavior.",
    schema: {
      chunk_id: z.string(),
      verdict: z.enum(["helpful", "incorrect", "outdated"]),
      note: z.string().optional(),
    },
    async handler(args) {
      await client.reportResult(String(args.chunk_id), String(args.verdict), args.note as string | undefined);
      return "Reported. Thank you — this feeds the quality benchmark.";
    },
  },
];
