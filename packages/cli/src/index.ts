import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  GrimoireClient,
  ApiError,
  browserLogin,
  clearRefreshToken,
  readRefreshToken,
  readMachineToken,
  resolveDefaultSources,
  loadGlobalConfig,
  type SourcePin,
} from "@monadeo.com/grimoire-core";
import { parseArgs, requirePositional, requireFlagOneOf, intFlag, UsageError } from "./args.js";
import { printResults, printCompact, EXIT } from "./output.js";
import { runSetup } from "./commands/setup.js";
import { runInit } from "./commands/init.js";
import { runConfig } from "./commands/config.js";
import { runUpdate } from "./commands/update.js";
import { notifyIfOutdated, refreshUpdateState } from "./updatecheck.js";

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

// Injected by esbuild from package.json at build time ("dev" when running
// unbundled source, e.g. under vitest).
declare const __GRIMOIRE_VERSION__: string | undefined;
const VERSION = typeof __GRIMOIRE_VERSION__ === "string" ? __GRIMOIRE_VERSION__ : "dev";

const HELP = `grimoire ${VERSION} — documentation retrieval for AI agents

  grimoire login | logout | whoami
  grimoire setup <claude-code|cursor|windsurf|codex>
  grimoire init
  grimoire search "<query>" [-s nextjs@15 -s react] [--lang en] [--top-k 8] [--json|--compact]
  grimoire sources [--q <kw>] [--names|--json]
  grimoire versions <source> [--json]
  grimoire config [<key>] [<value>] [--unset]
  grimoire update
  grimoire doc <chunk_id> [--window 2]
  grimoire report <chunk_id> --verdict helpful|incorrect|outdated [--note "..."]
  grimoire ingest <url> [--version 15.2] [--private] [--webhook URL] [--watch]
  grimoire jobs <job_id> [--watch]
  grimoire mcp [--http]
  grimoire help | --help | -h
  grimoire version | --version | -v

  env: GRIMOIRE_AUTH_TOKEN — machine token (CI, instead of login)
       GRIMOIRE_API_URL   — API origin without a path, e.g. https://grimoire-api-qa.monadeo.com
`;

// Canonical flag names each command accepts; parseArgs rejects anything else.
// Commands absent from this map skip validation and fall through to the
// unknown-command error.
const COMMAND_FLAGS: Record<string, readonly string[]> = {
  version: [], "--version": [], "-v": [],
  login: [], logout: [], setup: [], init: [], whoami: [],
  help: [], "--help": [], "-h": [],
  mcp: ["http"],
  config: ["unset"],
  update: [],
  search: ["source", "lang", "top-k", "json", "compact"],
  sources: ["q", "names", "json"],
  versions: ["json"],
  doc: ["window"],
  report: ["verdict", "note"],
  ingest: ["version", "private", "webhook", "watch"],
  jobs: ["watch"],
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest, { "-s": "source", "-q": "q" }, command !== undefined ? COMMAND_FLAGS[command] : []);
  const json = args.bools.has("json");

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${VERSION}\n`);
      return EXIT.ok;
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
    case "config":
      return runConfig(args);
    case "update":
      return runUpdate();
    case "mcp":
      process.stderr.write("Run the MCP server with: npx @monadeo.com/grimoire-mcp" + (args.bools.has("http") ? " --http\n" : "\n"));
      return EXIT.ok;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return EXIT.ok;
  }

  const client = new GrimoireClient();
  try {
    switch (command) {
      case "whoami": {
        if (process.env.GRIMOIRE_AUTH_TOKEN) {
          process.stdout.write("machine token configured (GRIMOIRE_AUTH_TOKEN)\n");
          return EXIT.ok;
        }
        if (readMachineToken()) {
          process.stdout.write("machine token configured (grimoire config auth-token)\n");
          return EXIT.ok;
        }
        if (!readRefreshToken()) {
          process.stderr.write("not logged in — run `grimoire login`\n");
          return EXIT.authRequired;
        }
        try {
          await client.refreshSession();
          process.stdout.write("logged in (browser session)\n");
          return EXIT.ok;
        } catch (err) {
          const reason = err instanceof ApiError ? err.code : (err as Error).message;
          process.stderr.write(`not logged in (${reason}) — run \`grimoire login\`\n`);
          return EXIT.authRequired;
        }
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
          // `grimoire init` only helps when there are dependencies to pin from —
          // suggesting it in an infra repo is a dead end (Astro 2026-07-18).
          const initHelps = existsSync(join(process.cwd(), "package.json")) || existsSync(join(process.cwd(), "requirements.txt"));
          process.stderr.write(
            "No sources selected. List what is indexed:\n" +
              "  grimoire sources\n" +
              "then scope the search:\n" +
              '  grimoire search "<query>" -s <source>[@version]\n' +
              (initHelps ? "or pin this project's sources from its dependencies:\n  grimoire init\n" : ""),
          );
          return EXIT.apiError;
        }
        const res = await client.search({
          query,
          sources,
          language: args.flags.lang?.[0],
          top_k: intFlag(args, "top-k"),
        });
        if (json) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
        else if (args.bools.has("compact")) printCompact(res.results, res.confidence, res.rerank_status);
        else printResults(res.results, res.confidence, res.rerank_status);
        return EXIT.ok;
      }
      case "sources": {
        const res = await client.listSources(args.flags.q?.[0]);
        const sources = res.sources ?? [];
        if (json) {
          process.stdout.write(JSON.stringify(sources, null, 2) + "\n");
        } else if (args.bools.has("names")) {
          for (const s of sources) process.stdout.write(`${s.source_id}\n`);
        } else {
          for (const s of sources) {
            // The precise product version is the identity users care about;
            // crawl-date ids are the fallback when no version is known.
            const latest = s.latest_semver ?? s.latest_version ?? "-";
            const vis = s.visibility === "private" ? " (private)" : "";
            const meta = [
              s.latest_chunks != null ? `${s.latest_chunks} chunks` : "",
              s.latest_pages != null ? `${s.latest_pages} pages` : "",
              s.latest_crawled_at ? `crawled ${s.latest_crawled_at.slice(0, 10)}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            process.stdout.write(
              [`${s.source_id}@${latest}${vis}`, meta, s.origin_url ?? ""].filter(Boolean).join("  ") + "\n",
            );
          }
        }
        return EXIT.ok;
      }
      case "versions": {
        const source = requirePositional(args, 0, "Usage: grimoire versions <source> [--json]");
        const res = await client.listVersions(source);
        const versions = res.versions ?? [];
        if (json) {
          process.stdout.write(JSON.stringify(versions, null, 2) + "\n");
          return EXIT.ok;
        }
        const available = versions.filter((v) => v.status === "active");
        if (available.length === 0) {
          process.stdout.write(`no active versions for ${source}\n`);
          return EXIT.ok;
        }
        for (const v of available) {
          const label = v.semver ?? v.version_id;
          const parts = [
            label,
            v.is_latest ? "latest" : "",
            `${v.chunk_count ?? 0} chunks`,
            `crawled ${(v.ingested_at ?? "").slice(0, 10)}`,
            v.semver ? `(${v.version_id})` : "",
          ].filter(Boolean);
          process.stdout.write(parts.join("  ") + "\n");
        }
        return EXIT.ok;
      }
      case "doc": {
        const chunkId = requirePositional(args, 0, "Usage: grimoire doc <chunk_id> [--window 2]");
        const window = intFlag(args, "window", { min: 0, max: 5 }) ?? 2;
        const res = await client.getContext(chunkId, window);
        process.stdout.write(JSON.stringify(res.chunks ?? [], null, 2) + "\n");
        return EXIT.ok;
      }
      case "report": {
        const usage = 'Usage: grimoire report <chunk_id> --verdict helpful|incorrect|outdated [--note "..."]';
        const chunkId = requirePositional(args, 0, usage);
        const verdict = requireFlagOneOf(args, "verdict", ["helpful", "incorrect", "outdated"], usage);
        await client.reportResult(chunkId, verdict, args.flags.note?.[0]);
        process.stdout.write("Reported.\n");
        return EXIT.ok;
      }
      case "ingest": {
        const url = requirePositional(
          args,
          0,
          "Usage: grimoire ingest <url> [--version 15.2] [--private] [--webhook URL] [--watch]",
        );
        const res = await client.submitSource({
          url,
          version: args.flags.version?.[0],
          visibility: args.bools.has("private") ? "private" : "public",
          webhook_url: args.flags.webhook?.[0],
        });
        process.stdout.write(`Job: ${res.job_id}\n`);
        if (args.bools.has("watch")) return watchJob(client, res.job_id);
        return EXIT.ok;
      }
      case "jobs": {
        const jobId = requirePositional(args, 0, "Usage: grimoire jobs <job_id> [--watch]");
        return args.bools.has("watch") ? watchJob(client, jobId) : printJob(client, jobId);
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n${HELP}`);
        return EXIT.apiError;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      // The API explains itself (message, available versions, suggestions) —
      // swallowing that detail leaves agents retrying blind.
      const body = (typeof err.body === "object" && err.body !== null ? err.body : {}) as {
        message?: string;
        available?: string[];
        did_you_mean?: string[];
      };
      process.stderr.write(`error: ${err.code}${body.message ? ` — ${body.message}` : ""}\n`);
      if (body.available?.length) process.stderr.write(`available: ${body.available.join(", ")}\n`);
      if (body.did_you_mean?.length) process.stderr.write(`did you mean: ${body.did_you_mean.join(", ")}\n`);
      if (err.status === 401) return EXIT.authRequired;
      if (err.status === 429) return EXIT.quota;
      if (err.status === 404) return EXIT.notFound;
      return EXIT.apiError;
    }
    throw err;
  }
}

const TERMINAL_STATUSES = ["complete", "failed", "rejected"];
const FAILED_STATUSES = ["failed", "rejected"];

async function printJob(client: GrimoireClient, jobId: string): Promise<number> {
  const job = await client.getJob(jobId);
  const status = job.status ?? "unknown";
  process.stdout.write(`${status} ${JSON.stringify(job.counters ?? {})}\n`);
  return FAILED_STATUSES.includes(status) ? EXIT.apiError : EXIT.ok;
}

const WATCH_POLL_MS = 5_000;
const WATCH_BACKOFF_CAP_MS = 30_000;
const WATCH_DEADLINE_MS = 30 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function watchJob(client: GrimoireClient, jobId: string): Promise<number> {
  const deadline = Date.now() + WATCH_DEADLINE_MS;
  let backoff = WATCH_POLL_MS;
  while (Date.now() < deadline) {
    try {
      const job = await client.getJob(jobId);
      const status = job.status ?? "unknown";
      process.stdout.write(`${status} ${JSON.stringify(job.counters ?? {})}\n`);
      if (TERMINAL_STATUSES.includes(status)) {
        return FAILED_STATUSES.includes(status) ? EXIT.apiError : EXIT.ok;
      }
      backoff = WATCH_POLL_MS;
      await sleep(WATCH_POLL_MS);
    } catch (err) {
      // Auth/permission/missing-job failures cannot heal on their own — bail out;
      // anything else (network, 5xx, timeout) is worth retrying with backoff.
      if (err instanceof ApiError && [401, 403, 404].includes(err.status)) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`poll failed (${reason}); retrying in ${backoff / 1000}s\n`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, WATCH_BACKOFF_CAP_MS);
    }
  }
  process.stderr.write(
    `Watch deadline (30m) reached; the job is still running. Check later with: grimoire jobs ${jobId}\n`,
  );
  return EXIT.apiError;
}

notifyIfOutdated(VERSION);
main(process.argv.slice(2))
  .then(async (code) => {
    await refreshUpdateState(VERSION, loadGlobalConfig().updateCheckHours);
    process.exit(code);
  })
  .catch((err) => {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(EXIT.apiError);
    }
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(EXIT.apiError);
  });
