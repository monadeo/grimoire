// The command surface: the help text, the flags each command accepts, and the
// client version. Kept in its own module so a test can read them without
// running the CLI. help.test.ts holds this file, the parser, and the readme
// together — a new command or flag has to appear in all three.

declare const __GRIMOIRE_VERSION__: string | undefined;
export const VERSION = typeof __GRIMOIRE_VERSION__ === "string" ? __GRIMOIRE_VERSION__ : "dev";

export const HELP = `grimoire ${VERSION} — documentation retrieval for AI agents

  grimoire login [--no-launch-browser] | logout | whoami
  grimoire setup <claude-code|cursor|windsurf|codex>
  grimoire init
  grimoire search "<query>" [-s nextjs@15 -s react] [--reranker <name>] [--json|--compact] [--debug] [--verbose]
  grimoire sources [--q <kw>] [--names|--json]
  grimoire versions <product> [--json]
  grimoire config [<key>] [<value>] [--unset]
  grimoire update
  grimoire doc <point_id> [--window 2] [--json]
  grimoire report <point_id> --verdict helpful|incorrect|outdated [--note "..."]
  grimoire ingest <url> --product <name> (--rolling | --fixed <version> | --npm <pkg> | --pypi <pkg> | --github <owner/repo> [--tag-pattern <regex>])
                        [--include <pattern>]... [--exclude <pattern>]... [--watch]
  grimoire jobs <job_id> [--watch]
  grimoire staff queue [--json] | approve <job_id> | reject <job_id> --reason "..."
  grimoire staff users [--json] | grant <subject> --name "..." [--staff on|off] | revoke <subject>
  grimoire staff token <name> --quota <per-day>
  grimoire staff jobs [--source <product|id>] [--state <state>] [--kind <kind>] [--limit 50] [--json]
  grimoire staff cancel <job_id>
  grimoire staff source <product|id> [--watch] [--json]
  grimoire staff source <product|id> [--include <pattern>]... [--exclude <pattern>]... [--status active|disabled] [--markdown on|off]
  grimoire staff source <product|id> (--rolling | --fixed <version> | --npm <pkg> | --pypi <pkg> | --github <owner/repo>)
  grimoire staff urls <product|id> [--state <crawl state>] [--limit 50] [--json]
  grimoire staff create <url> --product <name> (--rolling | --fixed <version> | --npm <pkg> | --pypi <pkg> | --github <owner/repo> [--tag-pattern <regex>]) [--include <pattern>]... [--exclude <pattern>]...
  grimoire staff upload <product|id> <page-url> <file.html>
  grimoire staff recrawl <product|id> | reindex <product|id> | purge <product|id> --yes
  grimoire mcp [--http]
  grimoire help | --help | -h
  grimoire version | --version | -v

  env: GRIMOIRE_AUTH_TOKEN — machine token (CI, instead of login)
       GRIMOIRE_API_URL   — API origin without a path
`;

// Canonical flag names each command accepts; parseArgs rejects anything else.
export const COMMAND_FLAGS: Record<string, readonly string[]> = {
  version: [], "--version": [], "-v": [],
  login: ["no-launch-browser"], logout: [], setup: [], init: [], whoami: [],
  help: [], "--help": [], "-h": [],
  mcp: ["http"],
  config: ["unset"],
  update: [],
  search: ["source", "json", "compact", "debug", "verbose", "reranker"],
  sources: ["q", "names", "json"],
  versions: ["json"],
  doc: ["window", "json"],
  report: ["verdict", "note"],
  ingest: ["product", "rolling", "fixed", "npm", "pypi", "github", "tag-pattern", "include", "exclude", "watch"],
  jobs: ["watch"],
  staff: ["reason", "name", "quota", "json", "source", "state", "kind", "limit", "include", "exclude", "status", "markdown", "yes", "watch", "rolling", "fixed", "npm", "pypi", "github", "tag-pattern", "staff", "product"],
};
