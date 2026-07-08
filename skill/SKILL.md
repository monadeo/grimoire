---
name: grimoire
description: Look up accurate, version-correct technical documentation for libraries, frameworks, and tools via the Grimoire CLI. Use for ANY question about a library's API, configuration, or behavior — even well-known ones — because your training data may be outdated and Grimoire indexes the current docs at the exact version in use. Trigger on API usage, config, error messages, or best-practices questions for any technology.
---

# Grimoire documentation lookup

Search curated, version-locked documentation instead of relying on training data.

## Usage

```
grimoire search "<one concept>" -s <source>[@version] [-s <another>] --compact
```

- One concept per query; iterate with refined queries rather than raising results.
- Omit `@version` for latest; pin it (`nextjs@15`) to match the project's stack.
- In a repo with `.grimoire.json`, omit `-s` — the pinned sources are used.
- If output says **CONFIDENCE: WEAK**, the docs likely don't cover it — tell the user rather than guessing.
- Cite the `Source:` URL on every chunk in your answer.

## Examples

```
grimoire search "revalidateTag on-demand cache invalidation" -s nextjs@15
grimoire search "declare query parameters with a pydantic model" -s fastapi
grimoire sources --q react        # discover source ids
grimoire versions nextjs          # list indexed versions
grimoire report <chunk_id> --verdict outdated   # docs contradicted observed behavior
```

## Setup (once)

```
npx @monadeo.com/grimoire-cli login
```
