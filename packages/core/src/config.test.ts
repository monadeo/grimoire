import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectConfig, loadGlobalConfig, DEFAULT_API_BASE } from "./config.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
  delete process.env.GRIMOIRE_API_URL;
  delete process.env.XDG_CONFIG_HOME;
});

describe("findProjectConfig", () => {
  it("walks up to find .grimoire.json", () => {
    const root = mkdtempSync(join(tmpdir(), "grim-"));
    dirs.push(root);
    writeFileSync(join(root, ".grimoire.json"), JSON.stringify({ sources: [{ source: "nextjs", version: "15.2" }] }));
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectConfig(nested)?.sources?.[0]).toEqual({ source: "nextjs", version: "15.2" });
  });

  it("returns undefined when absent", () => {
    const root = mkdtempSync(join(tmpdir(), "grim-"));
    dirs.push(root);
    expect(findProjectConfig(root)).toBeUndefined();
  });
});

describe("loadGlobalConfig", () => {
  it("defaults the API base and honors the env override", () => {
    const cfg = mkdtempSync(join(tmpdir(), "grimcfg-"));
    dirs.push(cfg);
    process.env.XDG_CONFIG_HOME = cfg;
    expect(loadGlobalConfig().apiBaseUrl).toBe(DEFAULT_API_BASE);
    process.env.GRIMOIRE_API_URL = "https://grimoire-api-qa.monadeo.com/v1";
    expect(loadGlobalConfig().apiBaseUrl).toBe("https://grimoire-api-qa.monadeo.com/v1");
  });
});
