import {
  DEFAULT_API_BASE,
  globalConfigPath,
  loadGlobalConfig,
  updateGlobalConfigFile,
  storeMachineToken,
  readMachineToken,
  clearMachineToken,
  type GlobalConfig,
} from "@monadeo.com/grimoire-core";
import { UsageError, type ParsedArgs } from "../args.js";
import { EXIT } from "../output.js";

interface KeySpec {
  prop: keyof GlobalConfig;
  describe: string;
  parse(raw: string): GlobalConfig[keyof GlobalConfig];
}

function intInRange(name: string, raw: string, min: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new UsageError(`${name} must be an integer >= ${min}`);
  }
  return value;
}

export const CONFIG_KEYS: Record<string, KeySpec> = {
  "api-url": {
    prop: "apiBaseUrl",
    describe: `API origin without a path (default ${DEFAULT_API_BASE}; env GRIMOIRE_API_URL overrides)`,
    parse: (raw) => {
      if (!/^https?:\/\/[^/]+$/.test(raw)) {
        throw new UsageError("api-url must be a bare origin, e.g. https://grimoire-api.monadeo.com");
      }
      return raw;
    },
  },
  "update-check-hours": {
    prop: "updateCheckHours",
    describe: "hours between CLI update checks (default 24, 0 disables)",
    parse: (raw) => intInRange("update-check-hours", raw, 0),
  },
  language: {
    prop: "defaultLanguage",
    describe: "default search language filter",
    parse: (raw) => {
      if (!raw) throw new UsageError("language must be non-empty");
      return raw;
    },
  },
  "max-response-tokens": {
    prop: "maxResponseTokens",
    describe: "search response token budget",
    parse: (raw) => intInRange("max-response-tokens", raw, 1),
  },
};

// auth-token is a secret and lives in a 0600 file, not the world-readable
// config.json — so it is handled outside the CONFIG_KEYS (GlobalConfig) framework.
const AUTH_TOKEN_KEY = "auth-token";
const MACHINE_TOKEN_RE = /^mt_[0-9a-f]{64}$/;
const USAGE =
  "Usage: grimoire config [<key>] [<value>] [--unset]  (keys: " +
  [...Object.keys(CONFIG_KEYS), AUTH_TOKEN_KEY].join(", ") +
  ")";

export function runConfig(args: ParsedArgs): number {
  const [key, value] = args.positionals;
  if (key === undefined) {
    const resolved = loadGlobalConfig();
    process.stdout.write(`config file: ${globalConfigPath()}\n`);
    for (const [name, spec] of Object.entries(CONFIG_KEYS)) {
      const current = resolved[spec.prop];
      process.stdout.write(`${name} = ${current === undefined ? "(unset)" : JSON.stringify(current)}  # ${spec.describe}\n`);
    }
    process.stdout.write(
      `${AUTH_TOKEN_KEY} = ${readMachineToken() ? "(set)" : "(unset)"}  # machine token, stored 0600 (env GRIMOIRE_AUTH_TOKEN overrides)\n`,
    );
    return EXIT.ok;
  }
  if (key === AUTH_TOKEN_KEY) {
    if (args.bools.has("unset")) {
      clearMachineToken();
      process.stdout.write(`${AUTH_TOKEN_KEY} unset\n`);
      return EXIT.ok;
    }
    if (value === undefined) {
      // Never echo the secret — report presence only.
      process.stdout.write(`${readMachineToken() ? "(set)" : "(unset)"}\n`);
      return EXIT.ok;
    }
    if (!MACHINE_TOKEN_RE.test(value)) {
      throw new UsageError("auth-token must be a machine token, e.g. mt_<64 hex chars>");
    }
    storeMachineToken(value);
    process.stdout.write(`${AUTH_TOKEN_KEY} set\n`);
    return EXIT.ok;
  }
  const spec = CONFIG_KEYS[key];
  if (!spec) throw new UsageError(USAGE);
  if (args.bools.has("unset")) {
    updateGlobalConfigFile({ [spec.prop]: undefined });
    process.stdout.write(`${key} unset\n`);
    return EXIT.ok;
  }
  if (value === undefined) {
    const current = loadGlobalConfig()[spec.prop];
    process.stdout.write(`${current === undefined ? "" : JSON.stringify(current)}\n`);
    return EXIT.ok;
  }
  updateGlobalConfigFile({ [spec.prop]: spec.parse(value) });
  process.stdout.write(`${key} = ${value}\n`);
  return EXIT.ok;
}
