import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { EXIT } from "../output.js";

const BREW_CMD = ["brew", "upgrade", "monadeo/tap/grimoire"];
const NPM_CMD = ["npm", "install", "-g", "@monadeo.com/grimoire-cli"];

// The running binary's real location tells us who installed it: Homebrew keeps
// everything under a Cellar/homebrew prefix, npm under a lib/node_modules
// global prefix. Anything else (pnpm dlx, npx cache, a repo checkout) is not
// ours to upgrade — print the choices instead of guessing.
export function detectInstallCommand(binPath: string): string[] | undefined {
  let real: string;
  try {
    real = realpathSync(binPath);
  } catch {
    return undefined;
  }
  if (/homebrew|\/Cellar\//i.test(real)) return BREW_CMD;
  if (/\/lib\/node_modules\//.test(real)) return NPM_CMD;
  return undefined;
}

export function runUpdate(): number {
  const cmd = detectInstallCommand(process.argv[1] ?? "");
  if (!cmd) {
    process.stderr.write(
      `Could not detect how grimoire was installed. Update with one of:\n  ${BREW_CMD.join(" ")}\n  ${NPM_CMD.join(" ")}\n`,
    );
    return EXIT.apiError;
  }
  process.stdout.write(`${cmd.join(" ")}\n`);
  const result = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`update failed: ${result.error.message}\n`);
    return EXIT.apiError;
  }
  return result.status === 0 ? EXIT.ok : EXIT.apiError;
}
