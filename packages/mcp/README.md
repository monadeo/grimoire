# @monadeo/grimoire-mcp

MCP server for [Grimoire](https://grimoire.monadeo.com), the documentation-retrieval
service for AI coding agents. Tools: `search`, `fetch_document`, `list_sources`,
`list_versions`, `report_result`.

```sh
npx -y @monadeo/grimoire-mcp          # stdio (default)
npx -y @monadeo/grimoire-mcp --http   # streamable HTTP on 127.0.0.1:$PORT
```

Easiest setup: `npx @monadeo/grimoire-cli setup <claude-code|cursor|windsurf|codex>`.
Authenticate once with `grimoire login` (or set `GRIMOIRE_AUTH_TOKEN`).

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
