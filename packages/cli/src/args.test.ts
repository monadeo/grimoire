import { describe, expect, it } from "vitest";
import { intFlag, parseArgs, requireFlagOneOf, requirePositional, UsageError } from "./args.js";

describe("parseArgs value-taking flags", () => {
  it("errors when a value-taking flag is the last token", () => {
    expect(() => parseArgs(["--reranker"])).toThrow(UsageError);
    expect(() => parseArgs(["--reranker"])).toThrow("--reranker requires a value");
  });

  it("errors when a value-taking flag is followed by another flag", () => {
    expect(() => parseArgs(["--reranker", "--json"])).toThrow(UsageError);
    expect(() => parseArgs(["-s", "-q"], { "-s": "source" })).toThrow("-s requires a value");
  });

  it("never consumes a following flag as a value", () => {
    expect(() => parseArgs(["--verdict", "--note", "x"])).toThrow(UsageError);
  });

  it("still accepts a normal value after the flag", () => {
    const a = parseArgs(["--reranker", "local"]);
    expect(a.flags.reranker).toEqual(["local"]);
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
  const SEARCH_FLAGS = ["source", "reranker", "json", "compact"];

  it("rejects a value-taking flag outside the allowed set instead of swallowing its value", () => {
    expect(() => parseArgs(["--rerank", "local"], {}, SEARCH_FLAGS)).toThrow(UsageError);
    expect(() => parseArgs(["--rerank", "local"], {}, SEARCH_FLAGS)).toThrow("Unknown flag --rerank");
  });

  it("rejects a bool flag outside the allowed set", () => {
    expect(() => parseArgs(["--watch"], {}, SEARCH_FLAGS)).toThrow("Unknown flag --watch");
  });

  it("accepts allowed flags, including via alias", () => {
    const a = parseArgs(["-s", "nextjs@16", "--reranker", "local", "--compact"], { "-s": "source" }, SEARCH_FLAGS);
    expect(a.flags.source).toEqual(["nextjs@16"]);
    expect(a.flags.reranker).toEqual(["local"]);
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
    expect(intFlag(parseArgs([]), "window")).toBeUndefined();
  });

  it("parses a valid integer", () => {
    expect(intFlag(parseArgs(["--window", "8"]), "window")).toBe(8);
  });

  it("rejects non-numeric and non-integer values", () => {
    expect(() => intFlag(parseArgs(["--window", "eight"]), "window")).toThrow(UsageError);
    expect(() => intFlag(parseArgs(["--window", "eight"]), "window")).toThrow("--window must be an integer");
    expect(() => intFlag(parseArgs(["--window", "2.5"]), "window")).toThrow(UsageError);
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
