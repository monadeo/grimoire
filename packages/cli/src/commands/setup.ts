import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// One-command agent onboarding (SDD decision 19 / clients spec): writes the MCP
// registration for the named agent. `npx @monadeo/grimoire-mcp` needs no global install.
const MCP_ENTRY = { command: "npx", args: ["-y", "@monadeo/grimoire-mcp"] };

interface AgentTarget {
  path: string;
  apply: (existing: Record<string, unknown>) => Record<string, unknown>;
}

function mcpServersMerge(key: string) {
  return (existing: Record<string, unknown>) => {
    const servers = (existing[key] as Record<string, unknown>) ?? {};
    return { ...existing, [key]: { ...servers, grimoire: MCP_ENTRY } };
  };
}

const AGENTS: Record<string, AgentTarget> = {
  "claude-code": { path: join(homedir(), ".claude.json"), apply: mcpServersMerge("mcpServers") },
  cursor: { path: join(homedir(), ".cursor", "mcp.json"), apply: mcpServersMerge("mcpServers") },
  windsurf: {
    path: join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    apply: mcpServersMerge("mcpServers"),
  },
  codex: { path: join(homedir(), ".codex", "mcp.json"), apply: mcpServersMerge("mcpServers") },
};

export function runSetup(agent: string | undefined): number {
  if (!agent || !(agent in AGENTS)) {
    process.stderr.write(`Usage: grimoire setup <${Object.keys(AGENTS).join("|")}>\n`);
    return 1;
  }
  const target = AGENTS[agent];
  const existing = existsSync(target.path)
    ? (JSON.parse(readFileSync(target.path, "utf8")) as Record<string, unknown>)
    : {};
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, JSON.stringify(target.apply(existing), null, 2));
  process.stdout.write(`Configured grimoire MCP for ${agent} at ${target.path}\n`);
  process.stdout.write("Run `grimoire login` if you haven't yet.\n");
  return 0;
}
