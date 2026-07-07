import { execFileSync } from "node:child_process";
import {
  GrimoireClient,
  ApiError,
  browserLogin,
  clearRefreshToken,
  resolveDefaultSources,
  loadGlobalConfig,
  type SourcePin,
} from "@monadeo/grimoire-core";
import { parseArgs } from "./args.js";
import { printResults, printCompact, EXIT } from "./output.js";
import { runSetup } from "./commands/setup.js";
import { runInit } from "./commands/init.js";

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    execFileSync(cmd, [url], { stdio: "ignore" });
  } catch {
    process.stdout.write(`Open this URL to log in:\n${url}\n`);
  }
}

function parseSourceFlags(values: string[] | undefined): SourcePin[] {
  return (values ?? []).map((v) => {
    const [source, version] = v.split("@");
    return version ? { source, version } : { source };
  });
}

const HELP = `grimoire — documentation retrieval for AI agents

  grimoire login | logout | whoami
  grimoire setup <claude-code|cursor|windsurf|codex>
  grimoire init
  grimoire search "<query>" [-s nextjs@15 -s react] [--lang en] [--top-k 8] [--json|--compact] [--no-rerank]
  grimoire sources [--q <kw>] [--json]
  grimoire versions <source> [--json]
  grimoire doc <chunk_id> [--window 2]
  grimoire report <chunk_id> --verdict incorrect|outdated|helpful [--note "..."]
  grimoire ingest <url> [--version 15.2] [--private] [--webhook URL] [--watch]
  grimoire jobs <job_id> [--watch] [--errors]
  grimoire mcp [--http]
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest, { "-s": "source", "-q": "q" });
  const json = args.bools.has("json");

  switch (command) {
    case "login": {
      await browserLogin(loadGlobalConfig().apiBaseUrl, openBrowser);
      process.stdout.write("Logged in.\n");
      return EXIT.ok;
    }
    case "logout":
      clearRefreshToken();
      process.stdout.write("Logged out.\n");
      return EXIT.ok;
    case "setup":
      return runSetup(args.positionals[0]);
    case "init":
      return runInit();
    case "mcp":
      process.stderr.write("Run the MCP server with: npx @monadeo/grimoire-mcp" + (args.bools.has("http") ? " --http\n" : "\n"));
      return EXIT.ok;
    case undefined:
    case "help":
    case "--help":
      process.stdout.write(HELP);
      return EXIT.ok;
  }

  const client = new GrimoireClient();
  try {
    switch (command) {
      case "whoami": {
        const usage = await client.search({ query: "ping", sources: resolveDefaultSources().slice(0, 1).length ? resolveDefaultSources().slice(0, 1) : [{ source: "_" }] }).catch(() => null);
        process.stdout.write(usage ? "Authenticated.\n" : "Authenticated (no default source to probe).\n");
        return EXIT.ok;
      }
      case "search": {
        const query = args.positionals[0];
        if (!query) {
          process.stderr.write("Usage: grimoire search \"<query>\" -s <source>\n");
          return EXIT.apiError;
        }
        const explicit = parseSourceFlags(args.flags.source);
        const sources = explicit.length > 0 ? explicit : resolveDefaultSources();
        if (sources.length === 0) {
          process.stderr.write("No sources. Pass -s <source> or run `grimoire init`.\n");
          return EXIT.apiError;
        }
        const res = await client.search({
          query,
          sources,
          language: args.flags.lang?.[0],
          top_k: args.flags["top-k"] ? Number(args.flags["top-k"][0]) : undefined,
        });
        if (json) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
        else if (args.bools.has("compact")) printCompact(res.results);
        else printResults(res.results, res.confidence);
        return EXIT.ok;
      }
      case "sources": {
        const res = await client.listSources(args.flags.q?.[0]);
        process.stdout.write(JSON.stringify(res.sources, null, json ? 2 : 0) + "\n");
        return EXIT.ok;
      }
      case "versions": {
        const res = await client.listVersions(args.positionals[0]);
        process.stdout.write(JSON.stringify(res.versions, null, json ? 2 : 0) + "\n");
        return EXIT.ok;
      }
      case "doc": {
        const res = await client.getContext(args.positionals[0], Number(args.flags.window?.[0] ?? 2));
        process.stdout.write(JSON.stringify(res.chunks, null, 2) + "\n");
        return EXIT.ok;
      }
      case "report": {
        await client.reportResult(args.positionals[0], args.flags.verdict?.[0] ?? "incorrect", args.flags.note?.[0]);
        process.stdout.write("Reported.\n");
        return EXIT.ok;
      }
      case "ingest": {
        const res = await client.submitSource({
          url: args.positionals[0],
          version: args.flags.version?.[0],
          visibility: args.bools.has("private") ? "private" : "public",
          webhook_url: args.flags.webhook?.[0],
        });
        process.stdout.write(`Job: ${res.job_id}\n`);
        if (args.bools.has("watch")) return watchJob(client, res.job_id);
        return EXIT.ok;
      }
      case "jobs":
        return args.bools.has("watch") ? watchJob(client, args.positionals[0]) : printJob(client, args.positionals[0]);
      default:
        process.stderr.write(`Unknown command: ${command}\n${HELP}`);
        return EXIT.apiError;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      process.stderr.write(`error: ${err.code}\n`);
      if (err.status === 401) return EXIT.authRequired;
      if (err.status === 429) return EXIT.quota;
      if (err.status === 404) return EXIT.notFound;
      return EXIT.apiError;
    }
    throw err;
  }
}

async function printJob(client: GrimoireClient, jobId: string): Promise<number> {
  const job = await client.getJob(jobId);
  process.stdout.write(`${job.status} ${JSON.stringify(job.counters)}\n`);
  return job.status === "complete" ? EXIT.ok : EXIT.apiError;
}

async function watchJob(client: GrimoireClient, jobId: string): Promise<number> {
  for (;;) {
    const job = await client.getJob(jobId);
    process.stdout.write(`${job.status} ${JSON.stringify(job.counters)}\n`);
    if (["complete", "failed", "rejected"].includes(job.status)) {
      return job.status === "complete" ? EXIT.ok : EXIT.apiError;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(EXIT.apiError);
  });
