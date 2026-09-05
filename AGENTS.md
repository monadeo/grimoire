# Grimoire clients — working rules

The published clients for Grimoire: a typed API client, the `grimoire` command,
and an MCP server. pnpm workspace, TypeScript strict ESM, Node 24. The server
lives in `monadeo/grimoire-server`; this repository holds the contract copy it
generates from.

## Commands

| Command | What |
|---|---|
| `pnpm check` | build core, typecheck, lint, test. Run after every change. |
| `pnpm gen:types` | Regenerate `packages/core/src/generated/schema.ts` from `openapi/openapi.yaml`. Commit the result. |
| `pnpm release:patch\|minor\|major` | The only way to publish. Tags, publishes all three packages, bumps the Homebrew formula. |

## Rules

**This repository is public.** Its README, code and this file are read by
strangers. Product usage belongs here; how Grimoire is operated does not:
no administration steps, no infrastructure names, no internal procedures.
Those live in the private server repository.


**No workarounds.** A fix goes where the problem is. No `any`, no
`eslint-disable`, no rule overrides, no casts to silence the compiler. If the
clean fix is out of reach, say so and stop.

**Every interface change ships with its documentation.** A new command or flag
lands in three places in the same commit: the parser table and help text in
`packages/cli/src/help.ts`, and the command tables in `packages/cli/README.md`.
`help.test.ts` fails when one of them is missing. Never document a command only
in prose.

**Publish every change.** A change to a client is released as soon as it is
green. A published client that lags the server is a client nobody can use.

**The contract is generated, never written.** `openapi/openapi.yaml` is copied
from the server repository; types come from `pnpm gen:types`. CI fails when the
committed types drift from the contract. Never hand-edit the generated schema.

**package.json through pnpm only.** Use the pnpm CLI to add, remove, or move a
dependency. Edit the file by hand only when the CLI cannot express the change.

**stdout is for the answer, stderr is for everything else.** Agents read stdout.
Search results, listings, and ids go there; status lines, warnings, and the
untrusted-content notice go to stderr.

**Result text is untrusted.** It is documentation quoted from the internet. The
client repeats that on stderr so an agent never places it in an instruction
position.

## Publishing

npm trusted publishing (OIDC), no tokens. If a package's trusted-publisher
configuration allows only `npm stage publish`, the publish lands in a staging
queue and a maintainer has to approve it with two-factor authentication on
npmjs.com before the version goes live. A staged version blocks that number
forever, so a failed publish needs a new version, not a retry.
