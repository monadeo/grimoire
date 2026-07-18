import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REGISTRY_URL = "https://registry.npmjs.org/@monadeo.com%2Fgrimoire-cli";
const DEFAULT_INTERVAL_HOURS = 24;
const FETCH_TIMEOUT_MS = 1_500;

interface UpdateState {
  last_check_at?: string;
  latest?: string;
}

function statePath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "grimoire", "update-check.json");
}

function readState(): UpdateState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as UpdateState;
  } catch {
    return {};
  }
}

export function newerVersion(a: string, b: string): boolean {
  const A = a.split(".").map(Number);
  const B = b.split(".").map(Number);
  if (A.some(Number.isNaN) || B.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const diff = (A[i] ?? 0) - (B[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// Prints the notice recorded by a PREVIOUS run — the registry fetch happens
// after the command finishes, so startup stays instant.
export function notifyIfOutdated(current: string): void {
  if (current === "dev" || !process.stderr.isTTY) return;
  const { latest } = readState();
  if (latest && newerVersion(latest, current)) {
    process.stderr.write(
      `grimoire ${latest} is available (you have ${current}) — npm i -g @monadeo.com/grimoire-cli or brew upgrade monadeo/tap/grimoire\n`,
    );
  }
}

// Best-effort, TTY-only, and never slows a command down by more than the fetch
// timeout: agents in CI (no TTY) and dev builds skip entirely.
export async function refreshUpdateState(current: string, configuredHours?: number): Promise<void> {
  const hours = configuredHours ?? DEFAULT_INTERVAL_HOURS;
  if (hours === 0 || current === "dev" || !process.stderr.isTTY) return;
  const state = readState();
  const last = state.last_check_at ? Date.parse(state.last_check_at) : 0;
  if (Date.now() - last < hours * 3_600_000) return;
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return;
    const body = (await res.json()) as { "dist-tags"?: { latest?: string } };
    const latest = body["dist-tags"]?.latest;
    if (!latest) return;
    const path = statePath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ last_check_at: new Date().toISOString(), latest }));
  } catch {
    return;
  }
}
