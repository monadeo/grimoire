import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectManifestSources } from "./commands/init.js";
import { parseArgs } from "./args.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("detectManifestSources", () => {
  it("extracts npm deps with major version, stripping scopes", () => {
    const dir = mkdtempSync(join(tmpdir(), "grim-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "^15.2.0", "@tanstack/react-query": "5.0.0" } }),
    );
    const pins = detectManifestSources(dir);
    expect(pins).toContainEqual({ source: "next", version: "15" });
    expect(pins).toContainEqual({ source: "react-query", version: "5" });
  });

  it("extracts pinned pip requirements", () => {
    const dir = mkdtempSync(join(tmpdir(), "grim-"));
    dirs.push(dir);
    writeFileSync(join(dir, "requirements.txt"), "fastapi==0.110.0\nrequests>=2\n");
    expect(detectManifestSources(dir)).toContainEqual({ source: "fastapi", version: "0" });
  });
});

describe("parseArgs", () => {
  it("collects repeated source flags and bools", () => {
    const a = parseArgs(["query text", "-s", "nextjs@15", "-s", "react", "--json"], { "-s": "source" });
    expect(a.positionals).toEqual(["query text"]);
    expect(a.flags.source).toEqual(["nextjs@15", "react"]);
    expect(a.bools.has("json")).toBe(true);
  });
});
