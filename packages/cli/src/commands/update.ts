import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { EXIT } from "../output.js";

const BREW_CMD = ["brew", "upgrade", "monadeo/tap/grimoire"];
const NPM_CMD = ["npm", "install", "-g", "@monadeo.com/grimoire-cli"];

// The running binary's real location tells us who installed it: Homebrew keeps
// everything under a Cellar/homebrew prefix, npm under a lib/node_modules
// global prefix. Anything else (pnpm dlx, npx cache, a repo checkout) is not
// ours to upgrade — print the choices instead of guessing.
export function detectInstallKind(binPath: string): "brew" | "npm" | undefined {
  let real: string;
  try {
    real = realpathSync(binPath);
  } catch {
    return undefined;
  }
  if (/homebrew|\/Cellar\//i.test(real)) return "brew";
  if (/\/lib\/node_modules\//.test(real)) return "npm";
  return undefined;
}

// `brew upgrade` reads the LOCAL tap clone — without pulling it first, brew
// happily reports "already installed" for a version the registry has long
// superseded (observed 2026-07-18 upgrading 0.3.4→0.3.5). Pull just our tap,
// not `brew update`, which touches every tap and core. Best-effort: a pull
// failure still proceeds to upgrade with whatever the local tap knows.
function refreshTap(): void {
  const repo = spawnSync("brew", ["--repository", "monadeo/tap"], { encoding: "utf8" });
  const tapPath = repo.status === 0 ? repo.stdout.trim() : "";
  if (!tapPath) return;
  spawnSync("git", ["-C", tapPath, "pull", "--ff-only", "--quiet"], { stdio: "inherit" });
}

export function runUpdate(): number {
  const kind = detectInstallKind(process.argv[1] ?? "");
  if (!kind) {
    process.stderr.write(
      `Could not detect how grimoire was installed. Update with one of:\n  ${BREW_CMD.join(" ")}\n  ${NPM_CMD.join(" ")}\n`,
    );
    return EXIT.apiError;
  }
  if (kind === "brew") refreshTap();
  const cmd = kind === "brew" ? BREW_CMD : NPM_CMD;
  process.stdout.write(`${cmd.join(" ")}\n`);
  const result = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`update failed: ${result.error.message}\n`);
    return EXIT.apiError;
  }
  return result.status === 0 ? EXIT.ok : EXIT.apiError;
}
