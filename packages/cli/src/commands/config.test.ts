import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs, UsageError } from "../args.js";
import { runConfig } from "./config.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grimcfgcmd-"));
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

function file(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "grimoire", "config.json"), "utf8")) as Record<string, unknown>;
}

describe("grimoire config", () => {
  it("sets, gets, and unsets a key", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      runConfig(parseArgs(["update-check-hours", "12"]));
      expect(file().updateCheckHours).toBe(12);
      runConfig(parseArgs(["update-check-hours"]));
      expect(stdout).toHaveBeenLastCalledWith("12\n");
      runConfig(parseArgs(["update-check-hours", "--unset"]));
      expect(file().updateCheckHours).toBeUndefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it("lists all keys with the config path", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      runConfig(parseArgs([]));
      const out = stdout.mock.calls.map((c) => c[0]).join("");
      expect(out).toContain("config file:");
      expect(out).toContain("update-check-hours");
      expect(out).toContain("api-url");
    } finally {
      stdout.mockRestore();
    }
  });

  it("rejects unknown keys and invalid values", () => {
    expect(() => runConfig(parseArgs(["nope", "1"]))).toThrow(UsageError);
    expect(() => runConfig(parseArgs(["update-check-hours", "-1"]))).toThrow(UsageError);
    expect(() => runConfig(parseArgs(["api-url", "https://host/with-path"]))).toThrow(UsageError);
  });

  it("never bakes the env override into the file", () => {
    process.env.GRIMOIRE_API_URL = "https://env-only.example";
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      runConfig(parseArgs(["update-check-hours", "48"]));
      expect(file().apiBaseUrl).toBeUndefined();
    } finally {
      stdout.mockRestore();
      delete process.env.GRIMOIRE_API_URL;
    }
  });
});
