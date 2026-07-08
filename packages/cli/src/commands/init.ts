import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SourcePin } from "@monadeo.com/grimoire-core";

function parseJsonFile<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    throw new Error(`Cannot parse ${path}: ${(err as Error).message}`, { cause: err });
  }
}

// Scan common manifests → propose .grimoire.json source pins. Alias resolution
// against the registry (curated to include package-ecosystem names) happens when
// the sources are actually queried; init proposes candidate names from manifests.
export function detectManifestSources(dir = process.cwd()): SourcePin[] {
  const pins: SourcePin[] = [];
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = parseJsonFile<{ dependencies?: Record<string, string> }>(pkgPath);
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      const major = range.match(/(\d+)/)?.[1];
      pins.push({ source: name.replace(/^@[^/]+\//, ""), ...(major ? { version: major } : {}) });
    }
  }
  const reqPath = join(dir, "requirements.txt");
  if (existsSync(reqPath)) {
    for (const line of readFileSync(reqPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Za-z0-9_.-]+)\s*==\s*(\d+)/);
      if (m) pins.push({ source: m[1].toLowerCase(), version: m[2] });
    }
  }
  return pins;
}

export function runInit(): number {
  const path = join(process.cwd(), ".grimoire.json");
  try {
    const sources = detectManifestSources();
    if (sources.length === 0) {
      process.stderr.write("No package.json/requirements.txt dependencies found.\n");
      return 1;
    }
    const existing = existsSync(path) ? parseJsonFile<Record<string, unknown>>(path) : {};
    writeFileSync(path, JSON.stringify({ ...existing, sources }, null, 2));
    process.stdout.write(`Wrote ${sources.length} source pins to .grimoire.json\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
}
