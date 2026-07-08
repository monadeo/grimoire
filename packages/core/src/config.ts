import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SourcePin {
  source: string;
  version?: string;
}

export interface GlobalConfig {
  apiBaseUrl: string;
  defaultSources?: SourcePin[];
  defaultLanguage?: string;
  maxResponseTokens?: number;
}

export interface ProjectConfig {
  sources?: SourcePin[];
  language?: string;
}

// Bare origin — API paths are absolute (/v1/..., /auth/cli/...), so the base must
// never carry a path prefix or auth-broker URLs would be built wrong.
export const DEFAULT_API_BASE = "https://grimoire-api.monadeo.com";

function globalConfigPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "grimoire", "config.json");
}

// Malformed config must never crash a consumer (the MCP server constructs a client
// at import time): warn and behave as if the file were absent.
function readJsonConfig<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    process.stderr.write(
      `grimoire: ignoring malformed config at ${path}: ${(err as Error).message}\n`,
    );
    return undefined;
  }
}

export function loadGlobalConfig(): GlobalConfig {
  const path = globalConfigPath();
  const base: GlobalConfig = { apiBaseUrl: process.env.GRIMOIRE_API_URL ?? DEFAULT_API_BASE };
  if (!existsSync(path)) return base;
  const overrides = readJsonConfig<Partial<GlobalConfig>>(path);
  return overrides ? { ...base, ...overrides } : base;
}

export function saveGlobalConfig(config: GlobalConfig): void {
  const path = globalConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

// Project config (.grimoire.json in the repo root) pins a codebase's sources and
// overrides globals — committed alongside the code it documents.
export function findProjectConfig(startDir = process.cwd()): ProjectConfig | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, ".grimoire.json");
    if (existsSync(candidate)) {
      const parsed = readJsonConfig<ProjectConfig>(candidate);
      if (parsed) return parsed;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function resolveDefaultSources(): SourcePin[] {
  return findProjectConfig()?.sources ?? loadGlobalConfig().defaultSources ?? [];
}
