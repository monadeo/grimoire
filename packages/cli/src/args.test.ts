import { describe, expect, it } from "vitest";
import { intFlag, parseArgs, requireFlagOneOf, requirePositional, UsageError } from "./args.js";

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

  it("treats --http as a bool flag", () => {
    const a = parseArgs(["--http"]);
    expect(a.bools.has("http")).toBe(true);
    expect(a.flags).toEqual({});
  });
});

describe("parseArgs unknown-flag rejection", () => {
  const SEARCH_FLAGS = ["source", "lang", "top-k", "json", "compact"];

  it("rejects a value-taking flag outside the allowed set instead of swallowing its value", () => {
    expect(() => parseArgs(["--top", "4"], {}, SEARCH_FLAGS)).toThrow(UsageError);
    expect(() => parseArgs(["--top", "4"], {}, SEARCH_FLAGS)).toThrow("Unknown flag --top");
  });

  it("rejects a bool flag outside the allowed set", () => {
    expect(() => parseArgs(["--watch"], {}, SEARCH_FLAGS)).toThrow("Unknown flag --watch");
  });

  it("accepts allowed flags, including via alias", () => {
    const a = parseArgs(["-s", "nextjs@16", "--top-k", "3", "--compact"], { "-s": "source" }, SEARCH_FLAGS);
    expect(a.flags.source).toEqual(["nextjs@16"]);
    expect(a.flags["top-k"]).toEqual(["3"]);
    expect(a.bools.has("compact")).toBe(true);
  });

  it("stays lenient when no allowed set is given", () => {
    expect(parseArgs(["--anything", "x"]).flags.anything).toEqual(["x"]);
  });
});

describe("requirePositional", () => {
  it("returns the positional when present", () => {
    expect(requirePositional(parseArgs(["job-1"]), 0, "Usage: grimoire jobs <job_id>")).toBe("job-1");
  });

  it("throws a usage error when the positional is missing", () => {
    expect(() => requirePositional(parseArgs([]), 0, "Usage: grimoire jobs <job_id>")).toThrow(UsageError);
    expect(() => requirePositional(parseArgs([]), 0, "Usage: grimoire jobs <job_id>")).toThrow(
      "Usage: grimoire jobs <job_id>",
    );
  });
});

describe("intFlag", () => {
  it("returns undefined when the flag is absent", () => {
    expect(intFlag(parseArgs([]), "top-k")).toBeUndefined();
  });

  it("parses a valid integer", () => {
    expect(intFlag(parseArgs(["--top-k", "8"]), "top-k")).toBe(8);
  });

  it("rejects non-numeric and non-integer values", () => {
    expect(() => intFlag(parseArgs(["--top-k", "eight"]), "top-k")).toThrow(UsageError);
    expect(() => intFlag(parseArgs(["--top-k", "eight"]), "top-k")).toThrow("--top-k must be an integer");
    expect(() => intFlag(parseArgs(["--top-k", "2.5"]), "top-k")).toThrow(UsageError);
  });

  it("enforces the range when one is given", () => {
    expect(intFlag(parseArgs(["--window", "0"]), "window", { min: 0, max: 5 })).toBe(0);
    expect(intFlag(parseArgs(["--window", "5"]), "window", { min: 0, max: 5 })).toBe(5);
    expect(() => intFlag(parseArgs(["--window", "6"]), "window", { min: 0, max: 5 })).toThrow(
      "--window must be between 0 and 5",
    );
  });
});

describe("requireFlagOneOf (report --verdict)", () => {
  const VERDICTS = ["helpful", "incorrect", "outdated"];
  const USAGE = "Usage: grimoire report <chunk_id> --verdict helpful|incorrect|outdated";

  it("returns an allowed value", () => {
    expect(requireFlagOneOf(parseArgs(["--verdict", "outdated"]), "verdict", VERDICTS, USAGE)).toBe(
      "outdated",
    );
  });

  it("throws a usage error when the flag is missing (no silent default)", () => {
    expect(() => requireFlagOneOf(parseArgs([]), "verdict", VERDICTS, USAGE)).toThrow(UsageError);
    expect(() => requireFlagOneOf(parseArgs([]), "verdict", VERDICTS, USAGE)).toThrow(USAGE);
  });

  it("throws a usage error on a value outside the allowed set", () => {
    expect(() => requireFlagOneOf(parseArgs(["--verdict", "wrong"]), "verdict", VERDICTS, USAGE)).toThrow(
      UsageError,
    );
  });
});
