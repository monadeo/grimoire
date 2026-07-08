import { describe, expect, it } from "vitest";
import { rewriteArgs, TOOLS } from "./tools.js";

const SEARCH_KEYS = ["query", "sources", "language", "max_response_tokens"];

describe("rewriteArgs", () => {
  it("maps hallucinated argument names to the schema names", () => {
    expect(rewriteArgs({ question: "how to X", library: "nextjs" }, SEARCH_KEYS)).toEqual({
      query: "how to X",
      source: "nextjs",
    });
  });
  it("maps chunk id variants", () => {
    expect(rewriteArgs({ chunkID: "a__b__0001" }, ["chunk_id", "window"])).toEqual({
      chunk_id: "a__b__0001",
    });
  });
  it("passes through already-correct names", () => {
    expect(rewriteArgs({ query: "x", top_k: 5 }, SEARCH_KEYS)).toEqual({ query: "x", top_k: 5 });
  });
  it("never rewrites a key the current tool declares (list_sources q)", () => {
    expect(rewriteArgs({ q: "react" }, ["q"])).toEqual({ q: "react" });
  });
  it("does not clobber an explicitly provided target", () => {
    expect(rewriteArgs({ q: "alias value", query: "explicit" }, SEARCH_KEYS)).toEqual({
      query: "explicit",
    });
  });
  it("uses each tool's own schema keys", () => {
    const listSources = TOOLS.find((t) => t.name === "list_sources");
    expect(rewriteArgs({ q: "react" }, Object.keys(listSources?.schema ?? {}))).toEqual({
      q: "react",
    });
  });
});

describe("TOOLS", () => {
  it("exposes the five documented tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "fetch_document",
      "list_sources",
      "list_versions",
      "report_result",
      "search",
    ]);
  });
  it("search description warns about weak confidence", () => {
    expect(TOOLS.find((t) => t.name === "search")?.description).toContain("weak");
  });
});
