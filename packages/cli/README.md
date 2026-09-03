# @monadeo.com/grimoire-cli

`grimoire` — command-line client for [Grimoire](https://grimoire.monadeo.com), the
documentation-retrieval service for AI coding agents.

```sh
npm install -g @monadeo.com/grimoire-cli
grimoire login
grimoire search "revalidateTag on-demand cache invalidation" -s nextjs@15
grimoire setup claude-code   # wire the MCP server into your agent
```

`grimoire login` prints the single sign-on URL (OAuth Authorization Code with PKCE
through Supabase Auth), opens it in your browser, and keeps a refresh token in
`~/.config/grimoire/credentials.json` (mode 0600). `--no-launch-browser` only prints
the URL, for headless or remote machines. Run `grimoire help`
for all commands. CI can set `GRIMOIRE_AUTH_TOKEN` with a machine token instead.

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
