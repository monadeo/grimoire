import { describe, expect, it } from "vitest";
import { rewriteArgs, TOOLS } from "./tools.js";

describe("rewriteArgs", () => {
  it("maps hallucinated argument names to the schema names", () => {
    expect(rewriteArgs({ question: "how to X", library: "nextjs" })).toEqual({
      query: "how to X",
      source: "nextjs",
    });
  });
  it("maps chunk id variants", () => {
    expect(rewriteArgs({ chunkID: "a__b__0001" })).toEqual({ chunk_id: "a__b__0001" });
  });
  it("passes through already-correct names", () => {
    expect(rewriteArgs({ query: "x", top_k: 5 })).toEqual({ query: "x", top_k: 5 });
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
