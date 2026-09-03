import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../args.js";
import { submissionFromArgs } from "./ingest.js";

const FLAGS = ["product", "rolling", "fixed", "npm", "pypi", "github", "include", "exclude", "watch"];

function args(argv: string[]) {
  return parseArgs(argv, {}, FLAGS);
}

describe("submissionFromArgs", () => {
  it("requires a product and a version rule", () => {
    expect(() => submissionFromArgs("https://d/", args([]))).toThrow(UsageError);
    expect(() => submissionFromArgs("https://d/", args(["--product", "x"]))).toThrow(/version rule is mandatory/);
  });

  it("maps --rolling, --fixed, and probes onto the contract", () => {
    expect(submissionFromArgs("https://d/", args(["--product", "x", "--rolling"]))).toEqual({
      url: "https://d/",
      product: "x",
      version_rule: { kind: "rolling" },
      include_patterns: [],
      exclude_patterns: [],
    });
    expect(submissionFromArgs("https://d/", args(["--product", "x", "--fixed", "26.3"])).version_rule).toEqual({
      kind: "fixed",
      value: "26.3",
    });
    const npm = submissionFromArgs("https://d/", args(["--product", "next", "--npm", "next", "--exclude", "/es/"]));
    expect(npm.probe).toEqual({ kind: "npm", package: "next" });
    expect(npm.version_rule).toEqual({ kind: "fixed" });
    expect(npm.exclude_patterns).toEqual(["/es/"]);
    expect(submissionFromArgs("https://d/", args(["--product", "x", "--github", "o/r"])).probe).toEqual({
      kind: "github",
      repo: "o/r",
    });
  });

  it("refuses more than one probe", () => {
    expect(() => submissionFromArgs("https://d/", args(["--product", "x", "--npm", "a", "--pypi", "b"]))).toThrow(
      /only one/,
    );
  });
});
