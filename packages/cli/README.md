# @monadeo.com/grimoire-cli

`grimoire` — command-line client for [Grimoire](https://grimoire.monadeo.com), the
documentation-retrieval service for AI coding agents.

```sh
npm install -g @monadeo.com/grimoire-cli
grimoire login
grimoire search "revalidateTag on-demand cache invalidation" -s nextjs@15
grimoire setup claude-code   # wire the MCP server into your agent
```

`grimoire login` asks for the email and password of your Grimoire account and keeps a
refresh token in `~/.config/grimoire/credentials.json` (mode 0600). Run `grimoire help`
for all commands. CI can set `GRIMOIRE_AUTH_TOKEN` with a machine token instead.

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
