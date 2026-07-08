#!/usr/bin/env node
// Lockstep release: the root and all three packages share one version so the
// publish workflow and the Homebrew formula bump always agree.
import { execSync } from "node:child_process";

const type = process.argv[2];
if (!["patch", "minor", "major"].includes(type ?? "")) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

run("pnpm check");

const packageDirs = [".", "packages/core", "packages/cli", "packages/mcp"];
let version = "";
for (const dir of packageDirs) {
  version = execSync(`npm version ${type} --no-git-tag-version`, {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

run(`git add ${packageDirs.map((d) => `${d}/package.json`).join(" ")}`);
run(`git commit -m "${version}"`);
run(`git tag ${version}`);
run("git push --follow-tags");
