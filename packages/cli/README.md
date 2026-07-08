# @monadeo/grimoire-cli

`grimoire` — command-line client for [Grimoire](https://grimoire.monadeo.com), the
documentation-retrieval service for AI coding agents.

```sh
npm install -g @monadeo/grimoire-cli
grimoire login
grimoire search "revalidateTag on-demand cache invalidation" -s nextjs@15
grimoire setup claude-code   # wire the MCP server into your agent
```

Run `grimoire help` for all commands. CI can set `GRIMOIRE_AUTH_TOKEN` with a machine
token instead of browser login.

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
