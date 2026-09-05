# @monadeo.com/grimoire-cli

`grimoire` — command-line client for [Grimoire](https://grimoire.monadeo.com), the
documentation-retrieval service for AI coding agents.

```sh
npm install -g @monadeo.com/grimoire-cli
grimoire login
grimoire search "revalidateTag on-demand cache invalidation" -s nextjs@15
grimoire setup claude-code   # wire the MCP server into your agent
```

`grimoire help` prints the same list and is the authoritative one.

## Account

| Command | What it does |
|---|---|
| `grimoire login [--no-launch-browser]` | Single sign-on, then prints the account it logged in as |
| `grimoire logout` | Forgets the stored session |
| `grimoire whoami` | Account, grant status, quota, and the server version behind the API |
| `grimoire version` | Client version |

Login is OAuth Authorization Code with PKCE through Supabase Auth. It always prints the
sign-on URL, opens it in your browser, and keeps a refresh token in
`~/.config/grimoire/credentials.json` (mode 0600). `--no-launch-browser` only prints the
URL, for headless or remote machines. CI can set `GRIMOIRE_AUTH_TOKEN` with a machine
token instead of logging in. `GRIMOIRE_API_URL` overrides the API origin.

## Retrieval

| Command | What it does |
|---|---|
| `grimoire search "<query>" [-s nextjs@15 -s react] [--reranker <name>] [--json\|--compact] [--debug] [--verbose]` | Search one or more sources. `--reranker` picks one of the rerankers `grimoire whoami` lists for your account; `--verbose` prints on stderr how long each stage took and which reranker ran. |
| `grimoire sources [--q <keyword>] [--names\|--json]` | List indexed sources |
| `grimoire versions <product> [--json]` | Versions indexed for a product |
| `grimoire doc <point_id> [--window 2] [--json]` | A chunk with its neighbours |
| `grimoire report <point_id> --verdict helpful\|incorrect\|outdated [--note "..."]` | Tell us a result was wrong |

## Agents and setup

| Command | What it does |
|---|---|
| `grimoire setup <claude-code\|cursor\|windsurf\|codex>` | Wire the MCP server into an agent |
| `grimoire init` | Write a project `.grimoire.json` with default sources |
| `grimoire config [<key>] [<value>] [--unset]` | Read or change client config: `api-url`, `update-check-hours`, `reranker`, `auth-token` |
| `grimoire mcp [--http]` | Run the MCP server on stdio, or over HTTP |
| `grimoire update` | Update the client in place |

## Ingestion

| Command | What it does |
|---|---|
| `grimoire ingest <url> --product <name> (--rolling \| --fixed <v> \| --npm <pkg> \| --pypi <pkg> \| --github <owner/repo>) [--include <pattern>]... [--exclude <pattern>]... [--watch]` | Submit a documentation site |
| `grimoire jobs <job_id> [--watch]` | Follow one job |

Every source needs a version rule: `--rolling` for docs without releases, otherwise the
release probe that tells Grimoire when a new version ships.

## Staff

These need a staff account.

| Command | What it does |
|---|---|
| `grimoire staff queue [--json]` | Submissions parked for review |
| `grimoire staff approve <job_id>` | Accept a parked submission |
| `grimoire staff reject <job_id> --reason "..."` | Reject one |
| `grimoire staff jobs [--source <product\|id>] [--state <state>] [--kind <kind>] [--limit 50] [--json]` | Recent jobs with their failure reasons |
| `grimoire staff cancel <job_id>` | Stop a queued or running crawl or index |
| `grimoire staff source <product\|id> [--watch] [--json]` | Where a source stands: route, scope, versions, crawl state, pages indexed, and the job it is in. `--watch` prints a line whenever that changes, until the job ends. |
| `grimoire staff urls <product\|id> [--state <crawl state>] [--limit 50] [--json]` | Every URL of a source with its crawl state, failures first and why |
| `grimoire staff source <product\|id> [--include <pattern>]... [--exclude <pattern>]... [--status active\|disabled] [--markdown on\|off]` | Change what a source covers and how it is fetched |
| `grimoire staff source <product\|id> (--rolling \| --fixed <v> \| --npm <pkg> \| --pypi <pkg> \| --github <owner/repo>)` | Correct how a source reads its version. Drops the chunks under the old label and reindexes from the stored crawl. |
| `grimoire staff recrawl <product\|id>` | Fetch the site again |
| `grimoire staff reindex <product\|id>` | Index the stored crawl again, no fetching |
| `grimoire staff purge <product\|id> --yes` | Delete a source and everything indexed from it |
| `grimoire staff users [--json]` | Access grants |
| `grimoire staff grant <subject> --name "..." [--staff on\|off]` | Grant access, and optionally make the account staff |
| `grimoire staff revoke <subject>` | Revoke access |
| `grimoire staff token <name> --quota <per-day>` | Mint a machine token, shown once |

`--markdown on` makes a source use the markdown its own site publishes (the "Copy page"
button) instead of a browser crawl. `--include` and `--exclude` take a substring, or a
regular expression behind `re:`. Changing scope marks out-of-scope pages for removal at
the next reindex.

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
