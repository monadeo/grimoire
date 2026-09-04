import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  GrimoireClient,
  ApiError,
  browserLogin,
  fetchAuthConfig,
  clearSession,
  readSession,
  readMachineToken,
  resolveDefaultSources,
  loadGlobalConfig,
  type JobOut,
  type SourceDetailOut,
  type SourceScopeIn,
  type SourcePin,
  type SourceSelector,
} from "@monadeo.com/grimoire-core";
import { parseArgs, requirePositional, requireFlagOneOf, intFlag, UsageError } from "./args.js";
import { COMMAND_FLAGS, HELP, VERSION } from "./help.js";
import { printResults, printCompact, EXIT } from "./output.js";
import { runSetup } from "./commands/setup.js";
import { runInit } from "./commands/init.js";
import { runConfig } from "./commands/config.js";
import { runUpdate } from "./commands/update.js";
import { submissionFromArgs } from "./commands/ingest.js";
import { notifyIfOutdated, refreshUpdateState } from "./updatecheck.js";

// The authorization URL is always printed so a user on a headless or remote
// machine can open it elsewhere; the browser launch is the default convenience.
function loginOpener(launchBrowser: boolean): (url: string) => void {
  return (url: string): void => {
    process.stdout.write(`${url}\n`);
    if (!launchBrowser) {
      process.stderr.write("Open the URL above in a browser to log in; waiting for the callback…\n");
      return;
    }
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      execFileSync(cmd, [url], { stdio: "ignore" });
    } catch {
      process.stderr.write("Could not open a browser; open the URL above manually.\n");
    }
  };
}

function parseSourceFlags(values: string[] | undefined): SourcePin[] {
  return (values ?? []).map((v) => {
    const [source, version] = v.split("@");
    return version ? { source, version } : { source };
  });
}

function toSelectors(pins: SourcePin[]): SourceSelector[] {
  return pins.map((p) => ({ product: p.source, ...(p.version ? { version: p.version } : {}) }));
}

// Injected by esbuild from package.json at build time ("dev" when running
// unbundled source, e.g. under vitest).

function describeError(err: ApiError): string {
  const detail =
    typeof err.body === "string"
      ? err.body
      : err.body !== undefined && err.body !== null
        ? JSON.stringify(err.body)
        : "";
  return `error: ${err.code}${detail ? ` — ${detail}` : ""}`;
}

// "email (kind subject) staff quota N/day", or the email with a plain reason
// when the account has no Grimoire grant yet — the login itself succeeded.
async function describeIdentity(client: GrimoireClient): Promise<string> {
  const email = await client.sessionEmail();
  const who = email ?? "machine token";
  try {
    const me = await client.me();
    return `${who} (${me.kind} ${me.subject})${me.is_staff ? "  staff" : ""}  quota ${me.quota_per_day}/day`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return `${who} — authenticated, but this account has no Grimoire access grant yet`;
    }
    throw err;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Staff commands take a source id or a product name; the name is looked up.
async function resolveSourceId(client: GrimoireClient, ref: string): Promise<string> {
  if (UUID_RE.test(ref)) return ref;
  const match = (await client.listSources()).find((s) => s.product === ref);
  if (!match) throw new UsageError(`No source with product "${ref}" — run \`grimoire sources\``);
  return match.id;
}

function describeSource(detail: SourceDetailOut): string {
  const frontier = Object.entries(detail.frontier)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");
  const lines = [
    `${detail.product}  ${detail.status}  ${detail.base_url}`,
    `id: ${detail.id}`,
    `route: ${detail.page_markdown ? "published page markdown" : "browser crawl"}`,
    `versions: ${detail.versions.length > 0 ? detail.versions.join(", ") : "(not indexed yet)"}`,
    `include: ${detail.include_patterns.join(" ") || "(all)"}  exclude: ${detail.exclude_patterns.join(" ") || "(none)"}`,
    `frontier: ${frontier || "(empty)"}`,
  ];
  if (detail.descoped_urls > 0) lines.push(`descoped: ${detail.descoped_urls} url(s) marked missing — run reindex to drop their chunks`);
  return lines.join("\n");
}

function describeJob(job: JobOut): string {
  // A job left behind by a restart still says "running"; say so plainly.
  const state = job.stalled ? `${job.state} (stalled, waiting to be picked up)` : job.state;
  const extra = [job.reason ? `reason: ${job.reason}` : "", job.source_id ? `source: ${job.source_id}` : ""]
    .filter(Boolean)
    .join("  ");
  return `${state}${extra ? `  ${extra}` : ""}`;
}

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
      const launch = !args.bools.has("no-launch-browser");
      process.stderr.write(launch ? "Opening your browser to log in…\n" : "Login URL:\n");
      await browserLogin(loadGlobalConfig().apiBaseUrl, loginOpener(launch));
      process.stdout.write(`Logged in as ${await describeIdentity(new GrimoireClient())}\n`);
      return EXIT.ok;
    }
    case "logout":
      clearSession();
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
        const via = process.env.GRIMOIRE_AUTH_TOKEN
          ? "GRIMOIRE_AUTH_TOKEN"
          : readMachineToken()
            ? "grimoire config auth-token"
            : readSession()
              ? "browser login"
              : undefined;
        if (!via) {
          process.stderr.write("not logged in — run `grimoire login`\n");
          return EXIT.authRequired;
        }
        const authConfig = await fetchAuthConfig(loadGlobalConfig().apiBaseUrl);
        process.stdout.write(`${await describeIdentity(client)}  via ${via}\n`);
        process.stdout.write(`server ${authConfig.server_version ?? "(older than 0.10.2)"}  ${loadGlobalConfig().apiBaseUrl}\n`);
        return EXIT.ok;
      }
      case "search": {
        const query = args.positionals[0];
        if (!query) {
          process.stderr.write('Usage: grimoire search "<query>" -s <product>[@version]\n');
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
              '  grimoire search "<query>" -s <product>[@version]\n' +
              (initHelps ? "or pin this project's sources from its dependencies:\n  grimoire init\n" : ""),
          );
          return EXIT.apiError;
        }
        const res = await client.search({ query, sources: toSelectors(sources), debug: args.bools.has("debug") });
        if (json) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
        else if (args.bools.has("compact")) printCompact(res);
        else printResults(res);
        return EXIT.ok;
      }
      case "sources": {
        const needle = args.flags.q?.[0]?.toLowerCase();
        const sources = (await client.listSources()).filter(
          (s) => !needle || s.product.toLowerCase().includes(needle) || s.base_url.toLowerCase().includes(needle),
        );
        if (json) {
          process.stdout.write(JSON.stringify(sources, null, 2) + "\n");
        } else if (args.bools.has("names")) {
          for (const s of sources) process.stdout.write(`${s.product}\n`);
        } else {
          for (const s of sources) {
            const versions = s.versions.length > 0 ? s.versions.join(", ") : "(not indexed yet)";
            process.stdout.write(`${s.product}  ${versions}  ${s.base_url}\n`);
          }
        }
        return EXIT.ok;
      }
      case "versions": {
        const product = requirePositional(args, 0, "Usage: grimoire versions <product> [--json]");
        const res = await client.listVersions(product);
        if (json) {
          process.stdout.write(JSON.stringify(res, null, 2) + "\n");
          return EXIT.ok;
        }
        for (const v of res.versions) {
          process.stdout.write(`${v.version}${v.version === res.latest ? "  latest" : ""}  ${v.chunk_count} chunks\n`);
        }
        return EXIT.ok;
      }
      case "doc": {
        const pointId = requirePositional(args, 0, "Usage: grimoire doc <point_id> [--window 2] [--json]");
        const window = intFlag(args, "window", { min: 0, max: 5 }) ?? 2;
        const res = await client.getDoc(pointId, window);
        if (json) {
          process.stdout.write(JSON.stringify(res, null, 2) + "\n");
          return EXIT.ok;
        }
        process.stderr.write(`${res.product}@${res.version}  ${res.heading_path.join(" › ")}\n${res.source_url}\n`);
        process.stdout.write(res.text + "\n");
        return EXIT.ok;
      }
      case "report": {
        const usage = 'Usage: grimoire report <point_id> --verdict helpful|incorrect|outdated [--note "..."]';
        const pointId = requirePositional(args, 0, usage);
        const verdict = requireFlagOneOf(args, "verdict", ["helpful", "incorrect", "outdated"], usage);
        await client.reportResult(pointId, verdict as "helpful" | "incorrect" | "outdated", args.flags.note?.[0]);
        process.stdout.write("Reported.\n");
        return EXIT.ok;
      }
      case "ingest": {
        const url = requirePositional(args, 0, "Usage: grimoire ingest <url> --product <name> --rolling|--fixed|--npm|--pypi|--github");
        const res = await client.submitSource(submissionFromArgs(url, args));
        process.stdout.write(`Job: ${res.job_id}\n`);
        if (args.bools.has("watch")) return watchJob(client, res.job_id);
        return EXIT.ok;
      }
      case "jobs": {
        const jobId = requirePositional(args, 0, "Usage: grimoire jobs <job_id> [--watch]");
        return args.bools.has("watch") ? watchJob(client, jobId) : printJob(client, jobId);
      }
      case "staff": {
        const usage =
          'Usage: grimoire staff queue [--json] | approve <job_id> | reject <job_id> --reason "..." | users [--json] | grant <subject> --name "..." | revoke <subject> | token <name> --quota <per-day> | jobs [--source <s>] [--state <st>] [--kind <k>] [--limit n] | cancel <job_id> | urls <s> [--state st] [--limit n] | source <s> [--include p]... [--exclude p]... [--status active|disabled] [--markdown on|off] | recrawl <s> | reindex <s> | purge <s> --yes';
        const [action, jobId] = args.positionals;
        if (action === "token") {
          const quota = intFlag(args, "quota", { min: 1, max: 1_000_000 });
          if (!jobId || quota === undefined) throw new UsageError(usage);
          const minted = await client.mintToken(jobId, quota);
          // The plain token is shown exactly once; the server keeps only its hash.
          process.stderr.write(`token ${minted.id}  ${minted.name}  quota ${minted.quota_per_day}/day — shown once, store it now\n`);
          process.stdout.write(`${minted.token}\n`);
          return EXIT.ok;
        }
        if (action === "urls") {
          if (!jobId) throw new UsageError(usage);
          const urls = await client.listFrontier(await resolveSourceId(client, jobId), {
            status: args.flags.state?.[0],
            limit: intFlag(args, "limit", { min: 1, max: 500 }),
          });
          if (json) process.stdout.write(JSON.stringify(urls, null, 2) + "\n");
          else if (urls.length === 0) process.stdout.write("no urls\n");
          else
            for (const u of urls)
              process.stdout.write(`${u.status}  ${u.url}${u.last_error ? `  — ${u.last_error}` : ""}\n`);
          return EXIT.ok;
        }
        if (action === "recrawl") {
          if (!jobId) throw new UsageError(usage);
          process.stdout.write(`${describeJob(await client.recrawlSource(await resolveSourceId(client, jobId)))}\n`);
          return EXIT.ok;
        }
        if (action === "reindex") {
          if (!jobId) throw new UsageError(usage);
          process.stdout.write(`${describeJob(await client.reindexSource(await resolveSourceId(client, jobId)))}\n`);
          return EXIT.ok;
        }
        if (action === "cancel") {
          if (!jobId) throw new UsageError(usage);
          process.stdout.write(`${describeJob(await client.cancelJob(jobId))}\n`);
          return EXIT.ok;
        }
        if (action === "jobs") {
          const sourceRef = args.flags.source?.[0];
          const found = await client.listJobs({
            sourceId: sourceRef ? await resolveSourceId(client, sourceRef) : undefined,
            state: args.flags.state?.[0],
            kind: args.flags.kind?.[0],
            limit: intFlag(args, "limit", { min: 1, max: 500 }),
          });
          if (json) process.stdout.write(JSON.stringify(found, null, 2) + "\n");
          else if (found.length === 0) process.stdout.write("no jobs\n");
          else for (const job of found) process.stdout.write(`${job.created_at}  ${job.id}  ${job.kind}  ${describeJob(job)}\n`);
          return EXIT.ok;
        }
        if (action === "source") {
          if (!jobId) throw new UsageError(usage);
          const sourceId = await resolveSourceId(client, jobId);
          const status = args.flags.status?.[0];
          if (status !== undefined && status !== "active" && status !== "disabled") throw new UsageError(usage);
          const markdown = args.flags.markdown?.[0];
          if (markdown !== undefined && markdown !== "on" && markdown !== "off") throw new UsageError(usage);
          const edit: SourceScopeIn = {};
          if (args.flags.include) edit.include_patterns = args.flags.include;
          if (args.flags.exclude) edit.exclude_patterns = args.flags.exclude;
          if (status) edit.status = status;
          if (markdown) edit.page_markdown = markdown === "on";
          const detail =
            Object.keys(edit).length > 0 ? await client.editSource(sourceId, edit) : await client.sourceDetail(sourceId);
          process.stdout.write(json ? JSON.stringify(detail, null, 2) + "\n" : `${describeSource(detail)}\n`);
          return EXIT.ok;
        }
        if (action === "purge") {
          if (!jobId) throw new UsageError(usage);
          if (!args.bools.has("yes")) {
            throw new UsageError("purge deletes the source, its crawl state, and every indexed chunk; add --yes to confirm");
          }
          const purged = await client.purgeSource(await resolveSourceId(client, jobId));
          process.stdout.write(
            `purged ${purged.product}  frontier=${purged.frontier_deleted}  jobs=${purged.jobs_deleted}  chunks removed by ${purged.points_deleted_by}\n`,
          );
          return EXIT.ok;
        }
        if (action === "users") {
          const users = await client.listUsers();
          if (json) process.stdout.write(JSON.stringify(users, null, 2) + "\n");
          else for (const u of users) process.stdout.write(`${u.subject}  ${u.status}  ${u.name}  by ${u.granted_by}\n`);
          return EXIT.ok;
        }
        if (action === "grant") {
          const name = args.flags.name?.[0];
          if (!jobId || !name) throw new UsageError(usage);
          const granted = await client.grantUser(jobId, name);
          process.stdout.write(`${granted.subject}  ${granted.status}  ${granted.name}\n`);
          return EXIT.ok;
        }
        if (action === "revoke") {
          if (!jobId) throw new UsageError(usage);
          const revoked = await client.revokeUser(jobId);
          process.stdout.write(`${revoked.subject}  ${revoked.status}\n`);
          return EXIT.ok;
        }
        if (action === "queue") {
          const queue = await client.reviewQueue();
          if (json) process.stdout.write(JSON.stringify(queue, null, 2) + "\n");
          else if (queue.length === 0) process.stdout.write("review queue is empty\n");
          else for (const job of queue) process.stdout.write(`${job.id}  ${describeJob(job)}\n`);
          return EXIT.ok;
        }
        if (!jobId) throw new UsageError(usage);
        if (action === "approve") {
          process.stdout.write(`${describeJob(await client.approveJob(jobId))}\n`);
          return EXIT.ok;
        }
        if (action === "reject") {
          const reason = args.flags.reason?.[0];
          if (!reason) throw new UsageError(usage);
          process.stdout.write(`${describeJob(await client.rejectJob(jobId, reason))}\n`);
          return EXIT.ok;
        }
        throw new UsageError(usage);
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n${HELP}`);
        return EXIT.apiError;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      process.stderr.write(`${describeError(err)}\n`);
      if (err.status === 401) return EXIT.authRequired;
      if (err.status === 403) return EXIT.authRequired;
      if (err.status === 429) return EXIT.quota;
      if (err.status === 404) return EXIT.notFound;
      return EXIT.apiError;
    }
    throw err;
  }
}

const TERMINAL_STATES = ["accepted", "done", "rejected", "failed", "pending_review"];
const FAILED_STATES = ["rejected", "failed"];

async function printJob(client: GrimoireClient, jobId: string): Promise<number> {
  const job = await client.getJob(jobId);
  process.stdout.write(`${describeJob(job)}\n`);
  return FAILED_STATES.includes(job.state) ? EXIT.apiError : EXIT.ok;
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
      process.stdout.write(`${describeJob(job)}\n`);
      if (TERMINAL_STATES.includes(job.state)) {
        if (job.state === "pending_review") {
          process.stderr.write("Parked for staff review: grimoire staff queue\n");
        }
        return FAILED_STATES.includes(job.state) ? EXIT.apiError : EXIT.ok;
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
