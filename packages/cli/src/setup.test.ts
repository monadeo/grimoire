import { describe, expect, it } from "vitest";
import { mergeCodexToml } from "./commands/setup.js";

const TABLE = `[mcp_servers.grimoire]
command = "npx"
args = ["-y", "@monadeo/grimoire-mcp"]
`;

describe("mergeCodexToml", () => {
  it("writes the table into an empty file", () => {
    expect(mergeCodexToml("")).toBe(TABLE);
  });

  it("appends after existing content with a blank-line separator", () => {
    const existing = `model = "o4"\n\n[history]\nmax = 100\n`;
    const merged = mergeCodexToml(existing);
    expect(merged).toBe(existing + "\n" + TABLE);
  });

  it("adds a newline first when the file does not end with one", () => {
    const merged = mergeCodexToml("model = \"o4\"");
    expect(merged).toBe(`model = "o4"\n\n` + TABLE);
  });

  it("replaces an existing grimoire table up to the next header", () => {
    const existing = [
      "model = \"o4\"",
      "",
      "[mcp_servers.grimoire]",
      "command = \"old\"",
      "args = [\"stale\"]",
      "",
      "[mcp_servers.other]",
      "command = \"keep\"",
      "",
    ].join("\n");
    const merged = mergeCodexToml(existing);
    expect(merged).toContain("model = \"o4\"");
    expect(merged).toContain(TABLE);
    expect(merged).toContain("[mcp_servers.other]\ncommand = \"keep\"");
    expect(merged).not.toContain("old");
    expect(merged).not.toContain("stale");
  });

  it("replaces an existing grimoire table at end of file", () => {
    const existing = `[history]\nmax = 100\n\n[mcp_servers.grimoire]\ncommand = "old"\n`;
    const merged = mergeCodexToml(existing);
    expect(merged).toBe(`[history]\nmax = 100\n\n` + TABLE);
  });

  it("is idempotent", () => {
    const once = mergeCodexToml("model = \"o4\"\n");
    expect(mergeCodexToml(once)).toBe(once);
  });

  it("preserves other mcp_servers tables verbatim", () => {
    const existing = `[mcp_servers.context7]\ncommand = "npx"\nargs = ["context7"]\n`;
    const merged = mergeCodexToml(existing);
    expect(merged.startsWith(existing)).toBe(true);
    expect(merged).toContain(TABLE);
  });
});
