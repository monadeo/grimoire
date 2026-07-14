# @monadeo.com/grimoire-core

Typed API client, browser login, and config resolution for
[Grimoire](https://grimoire.monadeo.com), the documentation-retrieval service for AI
coding agents. Used by `@monadeo.com/grimoire-cli` and `@monadeo.com/grimoire-mcp`.

```ts
import { GrimoireClient } from "@monadeo.com/grimoire-core";

const client = new GrimoireClient();
const res = await client.search({ query: "revalidateTag", sources: [{ source: "nextjs" }] });
```

Auth: browser login stores a refresh token in ~/.config/grimoire/credentials.json (0600); CI can set
`GRIMOIRE_AUTH_TOKEN` with a machine token instead.

Apache-2.0. Source: [monadeo/grimoire](https://github.com/monadeo/grimoire).
