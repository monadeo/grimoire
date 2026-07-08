# Grimoire — clients

Open-source CLI and MCP server for [Grimoire](https://grimoire.monadeo.com), the
documentation-retrieval service for AI coding agents. Apache-2.0.

**Trust posture:** these clients are open source and carry **zero telemetry**. Private
query text is never logged server-side; every result cites its origin URL. The service
backend is closed; the clients contain no secrets and no logic beyond presenting the API.

## Install

```sh
# Homebrew
brew tap monadeo/tap
brew install grimoire

# or npm
npm install -g @monadeo.com/grimoire-cli

grimoire login
grimoire setup claude-code               # wire the MCP server into your agent
```

## Packages

| Package | What |
|---|---|
| `@monadeo.com/grimoire-core` | Typed API client, auth broker login, config (`.grimoire.json`) |
| `@monadeo.com/grimoire-cli` | `grimoire` command — search, sources, ingest, setup, init |
| `@monadeo.com/grimoire-mcp` | MCP server (`npx @monadeo.com/grimoire-mcp`), stdio + streamable HTTP |

## MCP tools

`search`, `fetch_document`, `list_sources`, `list_versions`, `report_result`.

The client is generated against the service's published OpenAPI spec (vendored in
`openapi/`); a CI schema-drift check keeps it honest.
