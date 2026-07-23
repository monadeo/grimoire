import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMachineToken } from "@monadeo.com/grimoire-core";
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

  it("stores the machine token in a private file, never in config.json", () => {
    const token = "mt_" + "a".repeat(64);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      runConfig(parseArgs(["auth-token", token]));
      expect(readMachineToken()).toBe(token);
      // Bearer secret must not land in the world-readable config.json.
      expect(existsSync(join(dir, "grimoire", "config.json"))).toBe(false);
      // No group/other permission bits (0600), independent of the test umask.
      expect(statSync(join(dir, "grimoire", "machine-token")).mode & 0o077).toBe(0);
      runConfig(parseArgs(["auth-token"]));
      expect(stdout).toHaveBeenLastCalledWith("(set)\n");
      runConfig(parseArgs(["auth-token", "--unset"]));
      expect(readMachineToken()).toBeUndefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it("rejects a malformed machine token", () => {
    expect(() => runConfig(parseArgs(["auth-token", "not-a-token"]))).toThrow(UsageError);
  });

  it("lists auth-token presence without echoing the secret", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      runConfig(parseArgs([]));
      const out = stdout.mock.calls.map((c) => c[0]).join("");
      expect(out).toContain("auth-token = (unset)");
    } finally {
      stdout.mockRestore();
    }
  });
});
