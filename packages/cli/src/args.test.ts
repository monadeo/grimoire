import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "./args.js";

describe("parseArgs value-taking flags", () => {
  it("errors when a value-taking flag is the last token", () => {
    expect(() => parseArgs(["--lang"])).toThrow(UsageError);
    expect(() => parseArgs(["--lang"])).toThrow("--lang requires a value");
  });

  it("errors when a value-taking flag is followed by another flag", () => {
    expect(() => parseArgs(["--top-k", "--json"])).toThrow(UsageError);
    expect(() => parseArgs(["-s", "-q"], { "-s": "source" })).toThrow("-s requires a value");
  });

  it("never consumes a following flag as a value", () => {
    expect(() => parseArgs(["--verdict", "--note", "x"])).toThrow(UsageError);
  });

  it("still accepts a normal value after the flag", () => {
    const a = parseArgs(["--lang", "en"]);
    expect(a.flags.lang).toEqual(["en"]);
  });
});

describe("parseArgs bool flags", () => {
  it("does not treat bool flags as value-taking", () => {
    const a = parseArgs(["--json", "--watch"]);
    expect(a.bools.has("json")).toBe(true);
    expect(a.bools.has("watch")).toBe(true);
    expect(a.positionals).toEqual([]);
  });

  it("no longer recognizes removed flags as bools", () => {
    expect(() => parseArgs(["--no-rerank"])).toThrow(UsageError);
    expect(() => parseArgs(["--errors"])).toThrow(UsageError);
  });
});
