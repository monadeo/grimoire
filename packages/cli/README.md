# @monadeo.com/grimoire-cli

`grimoire` — command-line client for [Grimoire](https://grimoire.monadeo.com), the
documentation-retrieval service for AI coding agents.

```sh
npm install -g @monadeo.com/grimoire-cli
grimoire login
grimoire search "revalidateTag on-demand cache invalidation" -s nextjs@15
grimoire setup claude-code   # wire the MCP server and the skill into your agent
```

`grimoire help` prints the same list and is the authoritative one.

## Account

| Command | What it does |
|---|---|
| `grimoire login [--no-launch-browser]` | Single sign-on, then prints the account it logged in as |
| `grimoire logout` | Forgets the stored session |
| `grimoire whoami` | Account, grant status, quota, the rerankers you may pick, and the server version behind the API |
| `grimoire version` | Client version |

Login is OAuth Authorization Code with PKCE through Supabase Auth. It always prints the
sign-on URL, opens it in your browser, and keeps a refresh token in
`~/.config/grimoire/credentials.json` (mode 0600). `--no-launch-browser` only prints the
URL, for headless or remote machines. CI can set `GRIMOIRE_AUTH_TOKEN` with a machine
token instead of logging in. `GRIMOIRE_API_URL` overrides the API origin.

## Access

Sign in with `grimoire login`. Access to Grimoire is granted per account by its
operators; until then the CLI shows the account as authenticated without access.
Ask your administrator, quoting the subject that `grimoire login` prints.

## Retrieval

| Command | What it does |
|---|---|
| `grimoire search "<query>" [-s nextjs@15 -s react] [--reranker <name>] [--json\|--compact] [--debug] [--verbose]` | Search one or more sources. `--reranker` picks one of the rerankers `grimoire whoami` lists for your account; `--verbose` prints on stderr how long each stage took and which reranker ran. |
| `grimoire sources [-q <keyword>] [--names\|--json]` | List sources with version, stage, size as `<pages>p <chunks>c`, how the pages came in (`crawl` by rules or `upload` by staff) and URL; sources still in progress come first. Stages: waiting to crawl, crawling n/m pages, waiting to index, indexing n/m pages, indexed with its date, failed, cancelled |
| `grimoire versions <product> [--json]` | Versions indexed for a product, with chunk count and the date each was indexed |
| `grimoire doc <point_id> [--window 0-5] [--json]` | A chunk with its neighbours; the window is how many chunks each side, 2 by default |
| `grimoire report <point_id> --verdict helpful\|incorrect\|outdated [--note "..."]` | Tell us a result was wrong |

## Agents and setup

| Command | What it does |
|---|---|
| `grimoire setup <claude-code\|cursor\|windsurf\|codex>` | Wire the MCP server into an agent |
| `grimoire init` | Write a project `.grimoire.json` with default sources |
| `grimoire config [<key>] [<value>] [--unset]` | Read or change client config: `api-url`, `update-check-hours`, `reranker`, `skill-links`, `auth-token`. With no `reranker` set, the server picks its default |
| `grimoire mcp [--http]` | Print the command that starts the MCP server; the server itself is `@monadeo.com/grimoire-mcp` |
| `grimoire update` | Update the client in place. Once a day the CLI checks for a newer version and prints a yellow notice on stderr in a terminal; `NO_COLOR` makes it plain |
| `grimoire update skill` | Refresh the skill file and link it into the agents installed here |

The CLI ships a skill, a `SKILL.md` that tells an agent when and how to call `grimoire`.
The file lives at `~/.config/grimoire/skills/grimoire/SKILL.md` and is refreshed on every
run, so it always matches the installed client. Agents read it through a symlink:
`~/.claude/skills/grimoire` for Claude Code, `~/.agents/skills/grimoire` for Codex. The
first time the CLI runs in a terminal it names the links it would create and asks; a no
is remembered as `skill-links off`. `grimoire setup` and `grimoire update skill` ask
again. Agents calling the CLI without a terminal are never asked.

## Ingestion

| Command | What it does |
|---|---|
| `grimoire ingest <url> --product <name> (--rolling \| --fixed <v> \| --npm <pkg> \| --pypi <pkg> \| --github <owner/repo> [--tag-pattern <regex>]) [--include <pattern>]... [--exclude <pattern>]... [--watch]` | Submit a documentation site |
| `grimoire jobs <job_id> [--watch]` | Follow one job |

Every source needs a version rule: `--rolling` for docs without releases, otherwise the
release probe that tells Grimoire when a new version ships. When a GitHub release tag is
not a plain `v1.2.3`, give `--tag-pattern` a regular expression whose first group is the
version, for example `--tag-pattern 'release-(\d+\.\d+\.\d+)'` for nginx.

## Staff

These need a staff account.

| Command | What it does |
|---|---|
| `grimoire staff queue [--json]` | Submissions parked for review |
| `grimoire staff approve <job_id>` | Accept a parked submission |
| `grimoire staff reject <job_id> --reason "..."` | Reject one |
| `grimoire staff jobs [--source <product\|id>] [--state <state>] [--kind <kind>] [--limit 50] [--json]` | Recent jobs with their failure reasons |
| `grimoire staff workers [--json]` | Worker processes seen in the last day: version, last heartbeat, state and the job each holds. BUSY holds a job, IDLE waits, STOPPED ended on purpose, SILENT stopped reporting for 60 seconds. `queue` marks a dispatcher of the queue service |
| `grimoire staff cancel <job_id>` | Stop a queued or running crawl or index |
| `grimoire staff source <product\|id> [--watch] [--json]` | Where a source stands: route, scope, versions, crawl state, pages indexed, and the job it is in. `--watch` prints a line whenever that changes, until the job ends. |
| `grimoire staff urls <product\|id> [--state <crawl state>] [--limit 50] [--json]` | Every URL of a source with its crawl state, failures first and why |
| `grimoire staff source <product\|id> [--include <pattern>]... [--exclude <pattern>]... [--status active\|disabled] [--markdown on\|off] [--selector <css>\|none] [--executor worker\|queue] [--rate-delay <seconds>] [--sitemap <url>]` | Change what a source covers and how it is fetched. `--rate-delay` waits that many seconds between two pages, for sites that answer 429 at our pace; 0 clears it. `--selector` names the element that is the page's content, for example `.markdown-body` on GitHub pages; `none` clears it. Takes effect at the next index run. `--executor` names who runs the source's jobs: `queue`, the default since server 0.27.3, or `worker` to pin it to a legacy worker process |
| `grimoire staff source <product\|id> (--rolling \| --fixed <v> \| --npm <pkg> \| --pypi <pkg> \| --github <owner/repo> [--tag-pattern <regex>])` | Correct how a source reads its version. Drops the chunks under the old label and indexes again from the stored crawl. |
| `grimoire staff create <url> --product <name> (--rolling \| --fixed <v> \| --npm <pkg> \| --pypi <pkg> \| --github <owner/repo> [--tag-pattern <regex>]) [--include <pattern>]... [--exclude <pattern>]...` | Register a source the worker cannot fetch; its pages come in through `staff upload` |
| `grimoire staff upload <product\|id> <page-url> <file.html>` | Store one fetched page for an upload source; `staff recrawl` then processes what was uploaded |
| `grimoire staff recrawl <product\|id> [--failed]` | Fetch the site again. `--failed` fetches only the pages that failed last time and leaves the rest untouched |
| `grimoire staff index <product\|id> [--priority 0-10]` | Queue an index run over the stored crawl, no fetching. Lower priority runs first; index work sits at 10 by default |
| `grimoire staff purge <product\|id> --yes` | Delete a source and everything indexed from it |
| `grimoire staff users [--json]` | Access grants |
| `grimoire staff grant <subject> --name "..." [--staff on\|off]` | Grant access, and optionally make the account staff |
| `grimoire staff revoke <subject>` | Revoke access |
| `grimoire staff token <name> --quota <per-day>` | Mint a machine token, shown once |

`--markdown on` makes a source use the markdown its own site publishes (the "Copy page"
button) instead of a browser crawl. `--include` and `--exclude` take a substring, or a
regular expression behind `re:`. Changing scope marks out-of-scope pages for removal at
the next index run.

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
