import {
  DEFAULT_API_BASE,
  globalConfigPath,
  loadGlobalConfig,
  updateGlobalConfigFile,
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

const USAGE = "Usage: grimoire config [<key>] [<value>] [--unset]  (keys: " + Object.keys(CONFIG_KEYS).join(", ") + ")";

export function runConfig(args: ParsedArgs): number {
  const [key, value] = args.positionals;
  if (key === undefined) {
    const resolved = loadGlobalConfig();
    process.stdout.write(`config file: ${globalConfigPath()}\n`);
    for (const [name, spec] of Object.entries(CONFIG_KEYS)) {
      const current = resolved[spec.prop];
      process.stdout.write(`${name} = ${current === undefined ? "(unset)" : JSON.stringify(current)}  # ${spec.describe}\n`);
    }
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
