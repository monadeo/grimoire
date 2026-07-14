import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readRefreshToken } from "@monadeo.com/grimoire-core";

// One-command agent onboarding (SDD decision 19 / clients spec): writes the MCP
// registration for the named agent. `npx @monadeo.com/grimoire-mcp` needs no global install.
const MCP_ENTRY = { command: "npx", args: ["-y", "@monadeo.com/grimoire-mcp"] };

const CODEX_TABLE = `[mcp_servers.grimoire]
command = "npx"
args = ["-y", "@monadeo.com/grimoire-mcp"]
`;

// Codex reads ~/.codex/config.toml. Replace our table in place (up to the next
// [ header or EOF) without a TOML library, so the rest of the user's config
// passes through byte-for-byte.
export function mergeCodexToml(existing: string): string {
  const header = existing.match(/^[ \t]*\[mcp_servers\.grimoire\][ \t]*(\r?\n|$)/m);
  if (!header || header.index === undefined) {
    if (existing.trim() === "") return CODEX_TABLE;
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    return existing + sep + CODEX_TABLE;
  }
  const afterHeader = header.index + header[0].length;
  const nextHeader = existing.slice(afterHeader).match(/^[ \t]*\[/m);
  const end =
    nextHeader && nextHeader.index !== undefined ? afterHeader + nextHeader.index : existing.length;
  return existing.slice(0, header.index) + CODEX_TABLE + existing.slice(end);
}

interface JsonAgentTarget {
  path: string;
  apply: (existing: Record<string, unknown>) => Record<string, unknown>;
}

function mcpServersMerge(key: string) {
  return (existing: Record<string, unknown>) => {
    const servers = (existing[key] as Record<string, unknown>) ?? {};
    return { ...existing, [key]: { ...servers, grimoire: MCP_ENTRY } };
  };
}

const JSON_AGENTS: Record<string, JsonAgentTarget> = {
  "claude-code": { path: join(homedir(), ".claude.json"), apply: mcpServersMerge("mcpServers") },
  cursor: { path: join(homedir(), ".cursor", "mcp.json"), apply: mcpServersMerge("mcpServers") },
  windsurf: {
    path: join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    apply: mcpServersMerge("mcpServers"),
  },
};

const AGENT_NAMES = [...Object.keys(JSON_AGENTS), "codex"];

function setupCodex(): number {
  const path = join(homedir(), ".codex", "config.toml");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, mergeCodexToml(existing));
  return finish("codex", path);
}

// Best-effort session probe: a keychain that can't be read (no grant yet,
// headless box) must fall through to the hint, never crash setup.
function hasSession(): boolean {
  if (process.env.GRIMOIRE_AUTH_TOKEN) return true;
  try {
    return readRefreshToken() !== undefined;
  } catch {
    return false;
  }
}

function finish(agent: string, path: string): number {
  process.stdout.write(`Configured grimoire MCP for ${agent} at ${path}\n`);
  process.stdout.write(hasSession() ? "Already logged in.\n" : "Run `grimoire login` to authenticate.\n");
  return 0;
}

export function runSetup(agent: string | undefined): number {
  if (!agent || !AGENT_NAMES.includes(agent)) {
    process.stderr.write(`Usage: grimoire setup <${AGENT_NAMES.join("|")}>\n`);
    return 1;
  }
  if (agent === "codex") return setupCodex();
  const target = JSON_AGENTS[agent];
  let existing: Record<string, unknown> = {};
  if (existsSync(target.path)) {
    try {
      existing = JSON.parse(readFileSync(target.path, "utf8")) as Record<string, unknown>;
    } catch (err) {
      process.stderr.write(
        `Cannot parse ${target.path}: ${(err as Error).message}\nFix or remove the file, then re-run setup.\n`,
      );
      return 1;
    }
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, JSON.stringify(target.apply(existing), null, 2));
  return finish(agent, target.path);
}
