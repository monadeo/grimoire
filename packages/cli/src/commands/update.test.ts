import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectInstallKind } from "./update.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function tempBin(realDir: string): { real: string; link: string } {
  const root = mkdtempSync(join(tmpdir(), "grimupd-"));
  dirs.push(root);
  const real = join(root, realDir, "grimoire.js");
  mkdirSync(join(root, realDir).replace(/\/grimoire\.js$/, ""), { recursive: true });
  mkdirSync(join(real, ".."), { recursive: true });
  writeFileSync(real, "");
  const link = join(root, "bin-grimoire");
  symlinkSync(real, link);
  return { real, link };
}

describe("detectInstallKind", () => {
  it("detects a Homebrew install through the bin symlink", () => {
    const { link } = tempBin("homebrew/Cellar/grimoire/0.3.3/libexec");
    expect(detectInstallKind(link)).toBe("brew");
  });

  it("detects a global npm install", () => {
    const { link } = tempBin("nodejs/lib/node_modules/@monadeo.com/grimoire-cli/dist");
    expect(detectInstallKind(link)).toBe("npm");
  });

  it("refuses to guess for unknown layouts and missing paths", () => {
    const { link } = tempBin("some/checkout/packages/cli/dist");
    expect(detectInstallKind(link)).toBeUndefined();
    expect(detectInstallKind("/nonexistent/grimoire")).toBeUndefined();
  });
});
