import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { configDir, loadGlobalConfig, updateGlobalConfigFile } from "@monadeo.com/grimoire-core";
import { EXIT } from "../output.js";

// The skill ships inside the CLI so the instructions an agent reads always
// describe the commands this binary has. esbuild inlines skill/SKILL.md at
// build time; unbundled source (vitest) reads the file.
declare const __GRIMOIRE_SKILL__: string | undefined;
export const SKILL_TEXT: string =
  typeof __GRIMOIRE_SKILL__ === "string"
    ? __GRIMOIRE_SKILL__
    : readFileSync(new URL("../../skill/SKILL.md", import.meta.url), "utf8");

// One copy of the skill lives in Grimoire's own folder; every agent gets a
// symlink to it, so a CLI upgrade updates all of them at once.
export function skillDir(): string {
  return join(configDir(), "skills", "grimoire");
}

export function installSkillFile(): "written" | "unchanged" {
  const path = join(skillDir(), "SKILL.md");
  if (existsSync(path) && readFileSync(path, "utf8") === SKILL_TEXT) return "unchanged";
  mkdirSync(skillDir(), { recursive: true });
  writeFileSync(path, SKILL_TEXT);
  return "written";
}

interface AgentSkillHome {
  agent: string;
  /** The agent is installed when this directory exists. */
  marker: (home: string) => string;
  /** Where the agent reads personal skills; the link is created here. */
  link: (home: string) => string;
}

// Skill folders per the agents' documentation: Claude Code reads
// ~/.claude/skills/<name>, Codex reads ~/.agents/skills/<name>.
const AGENTS: readonly AgentSkillHome[] = [
  {
    agent: "claude-code",
    marker: (home) => join(home, ".claude"),
    link: (home) => join(home, ".claude", "skills", "grimoire"),
  },
  {
    agent: "codex",
    marker: (home) => join(home, ".codex"),
    link: (home) => join(home, ".agents", "skills", "grimoire"),
  },
];

export type LinkState = "linked" | "missing" | "occupied";

export interface LinkPlan {
  agent: string;
  path: string;
  state: LinkState;
}

function linkState(path: string, target: string): LinkState {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return "missing";
  }
  if (stat.isSymbolicLink()) {
    try {
      if (realpathSync(path) === realpathSync(target)) return "linked";
    } catch {
      // A dangling link is occupied: the user put something there once.
    }
  }
  return "occupied";
}

export function planLinks(home: string = homedir()): LinkPlan[] {
  const target = skillDir();
  return AGENTS.filter((a) => existsSync(a.marker(home))).map((a) => ({
    agent: a.agent,
    path: a.link(home),
    state: linkState(a.link(home), target),
  }));
}

export function applyLinks(plan: readonly LinkPlan[]): void {
  const target = skillDir();
  for (const entry of plan) {
    if (entry.state === "linked") continue;
    if (entry.state === "occupied") rmSync(entry.path, { recursive: true, force: true });
    mkdirSync(dirname(entry.path), { recursive: true });
    symlinkSync(target, entry.path, "dir");
  }
}

function describe(entry: LinkPlan): string {
  const what = entry.state === "occupied" ? `replace ${entry.path} (${describeOccupant(entry.path)}) with a link` : `link ${entry.path}`;
  return `  ${entry.agent}: ${what} -> ${skillDir()}`;
}

function describeOccupant(path: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return `a link to ${readlinkSync(path)}`;
  return stat.isDirectory() ? "a directory" : "a file";
}

// Ctrl+D or a closed stdin rejects the question; either one is a no.
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

// `grimoire update skill`: refresh the file and offer the links, whatever the
// user answered before.
export async function runUpdateSkill(): Promise<number> {
  const file = installSkillFile();
  process.stderr.write(`skill ${file}: ${join(skillDir(), "SKILL.md")}\n`);
  const plan = planLinks();
  const pending = plan.filter((e) => e.state !== "linked");
  if (plan.length === 0) {
    process.stderr.write("no agent found (looked for ~/.claude and ~/.codex); nothing to link\n");
    return EXIT.ok;
  }
  for (const entry of plan.filter((e) => e.state === "linked")) {
    process.stderr.write(`  ${entry.agent}: ${entry.path} already linked\n`);
  }
  if (pending.length === 0) return EXIT.ok;
  process.stderr.write("Grimoire will:\n" + pending.map(describe).join("\n") + "\n");
  if (!interactive()) {
    process.stderr.write("not a terminal; run `grimoire update skill` interactively to create the links\n");
    return EXIT.apiError;
  }
  if (!(await confirm("Proceed? [y/N] "))) {
    process.stderr.write("left as is\n");
    return EXIT.ok;
  }
  applyLinks(pending);
  process.stderr.write("done\n");
  return EXIT.ok;
}

// After an ordinary command in a terminal: keep our copy current without
// asking, and ask once before touching another tool's folder. Non-interactive
// runs (agents, CI) never see this.
export async function offerSkillLinks(): Promise<void> {
  if (!interactive()) return;
  installSkillFile();
  if (loadGlobalConfig().skillLinks === "off") return;
  const pending = planLinks().filter((e) => e.state !== "linked");
  if (pending.length === 0) return;
  process.stderr.write(
    "\nGrimoire ships a skill that teaches agents how to use it. It can link it into the agents found here:\n" +
      pending.map(describe).join("\n") +
      "\n",
  );
  if (await confirm("Create these links? [y/N] ")) {
    applyLinks(pending);
    process.stderr.write("done\n");
    return;
  }
  updateGlobalConfigFile({ skillLinks: "off" });
  process.stderr.write("left as is; `grimoire update skill` offers this again\n");
}
