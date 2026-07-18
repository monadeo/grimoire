import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newerVersion, notifyIfOutdated, refreshUpdateState } from "./updatecheck.js";

let dir: string;
let restoreTty: (() => void) | undefined;

function fakeTty(value: boolean): void {
  const original = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
  restoreTty = () => {
    if (original) Object.defineProperty(process.stderr, "isTTY", original);
    else delete (process.stderr as { isTTY?: boolean }).isTTY;
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grimupd-"));
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  restoreTty?.();
  restoreTty = undefined;
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("newerVersion", () => {
  it("compares semver triples", () => {
    expect(newerVersion("0.3.3", "0.3.2")).toBe(true);
    expect(newerVersion("0.3.2", "0.3.2")).toBe(false);
    expect(newerVersion("0.3.1", "0.3.2")).toBe(false);
    expect(newerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(newerVersion("abc", "0.3.2")).toBe(false);
  });
});

describe("notifyIfOutdated", () => {
  it("prints the recorded newer version on a TTY", () => {
    fakeTty(true);
    mkdirSync(join(dir, "grimoire"), { recursive: true });
    writeFileSync(join(dir, "grimoire", "update-check.json"), JSON.stringify({ latest: "9.9.9" }));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      notifyIfOutdated("0.3.2");
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("9.9.9 is available"));
    } finally {
      stderr.mockRestore();
    }
  });

  it("stays silent off-TTY and for dev builds", () => {
    fakeTty(false);
    mkdirSync(join(dir, "grimoire"), { recursive: true });
    writeFileSync(join(dir, "grimoire", "update-check.json"), JSON.stringify({ latest: "9.9.9" }));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      notifyIfOutdated("0.3.2");
      notifyIfOutdated("dev");
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("refreshUpdateState", () => {
  it("fetches and records the latest version when the interval elapsed", async () => {
    fakeTty(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ "dist-tags": { latest: "0.4.0" } }) })),
    );
    await refreshUpdateState("0.3.2", 24);
    const state = JSON.parse(readFileSync(join(dir, "grimoire", "update-check.json"), "utf8"));
    expect(state.latest).toBe("0.4.0");
    expect(state.last_check_at).toBeTruthy();
  });

  it("skips when disabled (0), recently checked, or off-TTY", async () => {
    fakeTty(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await refreshUpdateState("0.3.2", 0);
    mkdirSync(join(dir, "grimoire"), { recursive: true });
    writeFileSync(
      join(dir, "grimoire", "update-check.json"),
      JSON.stringify({ last_check_at: new Date().toISOString(), latest: "0.3.2" }),
    );
    await refreshUpdateState("0.3.2", 24);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
