import type { SubmissionIn } from "@monadeo.com/grimoire-core";
import { UsageError, type ParsedArgs } from "../args.js";

export function submissionFromArgs(url: string, args: ParsedArgs): SubmissionIn {
  const usage =
    "Usage: grimoire ingest <url> --product <name> (--rolling | --fixed <version> | --npm <pkg> | --pypi <pkg> | --github <owner/repo>)";
  const product = args.flags.product?.[0];
  if (!product) throw new UsageError(usage);
  const fixed = args.flags.fixed?.[0];
  const npm = args.flags.npm?.[0];
  const pypi = args.flags.pypi?.[0];
  const github = args.flags.github?.[0];
  const probes = [npm, pypi, github].filter(Boolean).length;
  if (probes > 1) throw new UsageError("Pass only one of --npm, --pypi, --github");

  const body: SubmissionIn = {
    url,
    product,
    version_rule: { kind: "rolling" },
    include_patterns: args.flags.include ?? [],
    exclude_patterns: args.flags.exclude ?? [],
  };
  if (args.bools.has("rolling")) return body;
  if (fixed) return { ...body, version_rule: { kind: "fixed", value: fixed } };
  if (npm) return { ...body, version_rule: { kind: "fixed" }, probe: { kind: "npm", package: npm } };
  if (pypi) return { ...body, version_rule: { kind: "fixed" }, probe: { kind: "pypi", package: pypi } };
  if (github) return { ...body, version_rule: { kind: "fixed" }, probe: { kind: "github", repo: github } };
  throw new UsageError(`${usage}\nA version rule is mandatory: --rolling for unversioned docs, --fixed, or a release probe.`);
}

