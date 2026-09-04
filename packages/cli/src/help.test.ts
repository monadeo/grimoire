import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMAND_FLAGS, HELP } from "./help.js";

const ALIASES: Record<string, string> = { source: "-s", q: "-q" };
// Flags the help text spells out in prose rather than in a usage line.
const UNLISTED = new Set(["reason", "name", "quota", "source", "state", "kind", "limit", "include", "exclude", "status", "markdown", "yes"]);

describe("help text", () => {
  const usageLines = HELP.split("\n").filter((line) => /^\s+grimoire /.test(line));

  it("names every command the parser accepts", () => {
    for (const command of Object.keys(COMMAND_FLAGS)) {
      if (command.startsWith("-")) continue;
      const named = usageLines.some((line) => new RegExp(`\\b${command}\\b`).test(line));
      expect(named, `\`${command}\` is missing from grimoire help`).toBe(true);
    }
  });

  it("names every flag the parser accepts", () => {
    for (const [command, flags] of Object.entries(COMMAND_FLAGS)) {
      if (command === "staff") continue; // covered by the staff usage lines below
      for (const flag of flags) {
        const spelled = HELP.includes(`--${flag}`) || HELP.includes(ALIASES[flag] ?? "\0");
        expect(spelled, `--${flag} of \`${command}\` is missing from grimoire help`).toBe(true);
      }
    }
  });

  it("spells out every staff flag", () => {
    for (const flag of COMMAND_FLAGS.staff) {
      if (!UNLISTED.has(flag)) continue;
      expect(HELP, `--${flag} is missing from the staff usage lines`).toContain(`--${flag}`);
    }
  });

  it("keeps the readme in step with the command list", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
    const commandLines = readme.split("\n").filter((line) => line.includes("grimoire "));
    for (const command of Object.keys(COMMAND_FLAGS)) {
      if (command.startsWith("-") || command === "help") continue;
      const named = commandLines.some((line) => new RegExp(`\\b${command}\\b`).test(line));
      expect(named, `\`${command}\` is missing from the CLI readme`).toBe(true);
    }
  });
});
