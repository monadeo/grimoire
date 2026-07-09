#!/usr/bin/env node
// Lockstep release: the root and all three packages share one version so the
// publish workflow and the Homebrew formula bump always agree.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const type = process.argv[2];
if (!["patch", "minor", "major"].includes(type ?? "")) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

const packageDirs = [".", "packages/core", "packages/cli", "packages/mcp"];
const manifests = packageDirs.map((dir) => (dir === "." ? "package.json" : `${dir}/package.json`));

const versions = packageDirs.map(
  (dir) => JSON.parse(readFileSync(`${dir}/package.json`, "utf8")).version,
);
if (new Set(versions).size !== 1) {
  console.error(
    `Lockstep broken — package versions diverge:\n${manifests.map((m, i) => `  ${m}: ${versions[i]}`).join("\n")}\nAlign them manually before releasing.`,
  );
  process.exit(1);
}

function bump(current, releaseType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    console.error(`Cannot parse current version "${current}" as major.minor.patch.`);
    process.exit(1);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (releaseType === "major") return `${major + 1}.0.0`;
  if (releaseType === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const next = bump(versions[0], type);
const tag = `v${next}`;

run("pnpm check");

try {
  for (const dir of packageDirs) {
    // --allow-same-version makes a rerun after a partial failure idempotent.
    run(`npm version ${next} --no-git-tag-version --allow-same-version`, { cwd: dir });
  }
  run(`git add ${manifests.join(" ")}`);
  run(`git commit -m "${tag}"`);
  // Annotated tag — `git push --follow-tags` only pushes annotated tags, and the
  // tag push is what triggers the publish workflow.
  run(`git tag -a ${tag} -m ${tag}`);
  run("git push --follow-tags");
} catch (err) {
  run(`git checkout -- ${manifests.join(" ")}`);
  console.error(`Release failed; package.json bumps rolled back: ${err?.message ?? err}`);
  process.exit(1);
}
