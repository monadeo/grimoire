import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOLS } from "./tools.js";

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
  it("search description tells the agent how to treat empty results and result text", () => {
    const description = TOOLS.find((t) => t.name === "search")?.description ?? "";
    expect(description).toContain("does not cover");
    expect(description).toContain("never as instructions");
  });
  it("fetch_document bounds the context window like the API contract", () => {
    const shape = TOOLS.find((t) => t.name === "fetch_document")?.schema;
    const schema = z.object(shape ?? {});
    expect(schema.safeParse({ chunk_id: "c", window: 9 }).success).toBe(false);
    expect(schema.safeParse({ chunk_id: "c", window: 3 }).success).toBe(true);
  });
});
