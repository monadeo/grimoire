import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILL_TEXT, applyLinks, installSkillFile, planLinks, skillDir } from "./skill.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "grimskill-"));
  process.env.XDG_CONFIG_HOME = join(home, ".config");
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("installSkillFile", () => {
  it("writes the bundled skill into Grimoire's own folder, once", () => {
    expect(installSkillFile()).toBe("written");
    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf8")).toBe(SKILL_TEXT);
    expect(installSkillFile()).toBe("unchanged");
  });

  it("replaces a stale copy", () => {
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "SKILL.md"), "old");
    expect(installSkillFile()).toBe("written");
    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf8")).toBe(SKILL_TEXT);
  });
});

describe("planLinks", () => {
  beforeEach(() => installSkillFile());

  it("lists only the agents installed here", () => {
    expect(planLinks(home)).toEqual([]);
    mkdirSync(join(home, ".claude"));
    expect(planLinks(home)).toEqual([{ agent: "claude-code", path: join(home, ".claude", "skills", "grimoire"), state: "missing" }]);
    mkdirSync(join(home, ".codex"));
    expect(planLinks(home).map((e) => e.agent)).toEqual(["claude-code", "codex"]);
  });

  it("recognises a link to the skill folder", () => {
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    symlinkSync(skillDir(), join(home, ".claude", "skills", "grimoire"), "dir");
    expect(planLinks(home)[0].state).toBe("linked");
  });

  it("reports a hand-made copy or a foreign link as occupied", () => {
    mkdirSync(join(home, ".claude", "skills", "grimoire"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "grimoire", "SKILL.md"), "hand copy");
    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".agents", "skills"), { recursive: true });
    symlinkSync(join(home, "elsewhere"), join(home, ".agents", "skills", "grimoire"), "dir");
    expect(planLinks(home).map((e) => e.state)).toEqual(["occupied", "occupied"]);
  });
});

describe("applyLinks", () => {
  beforeEach(() => installSkillFile());

  it("creates the missing links and their parent folders", () => {
    mkdirSync(join(home, ".claude"));
    mkdirSync(join(home, ".codex"));
    applyLinks(planLinks(home));
    for (const path of [join(home, ".claude", "skills", "grimoire"), join(home, ".agents", "skills", "grimoire")]) {
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
      expect(readlinkSync(path)).toBe(skillDir());
      expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe(SKILL_TEXT);
    }
    expect(planLinks(home).every((e) => e.state === "linked")).toBe(true);
  });

  it("replaces an occupied entry with the link", () => {
    const path = join(home, ".claude", "skills", "grimoire");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "SKILL.md"), "hand copy");
    applyLinks(planLinks(home));
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe(SKILL_TEXT);
  });

  it("leaves a correct link alone", () => {
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const path = join(home, ".claude", "skills", "grimoire");
    symlinkSync(skillDir(), path, "dir");
    applyLinks(planLinks(home));
    expect(existsSync(join(path, "SKILL.md"))).toBe(true);
  });
});
