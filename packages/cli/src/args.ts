// Minimal flag parser: collects repeated --flag/-f values and positionals.
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string[]>;
  bools: Set<string>;
}

export class UsageError extends Error {}

const BOOL_FLAGS = new Set(["json", "compact", "watch", "private", "names", "http"]);

export function parseArgs(argv: string[], aliases: Record<string, string> = {}): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string[]> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") || arg.startsWith("-")) {
      const name = aliases[arg] ?? arg.replace(/^--?/, "");
      if (BOOL_FLAGS.has(name)) {
        bools.add(name);
      } else {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith("-")) {
          throw new UsageError(`Flag ${arg} requires a value`);
        }
        (flags[name] ??= []).push(value);
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags, bools };
}

export function requirePositional(parsed: ParsedArgs, index: number, usage: string): string {
  const value = parsed.positionals[index];
  if (value === undefined) throw new UsageError(usage);
  return value;
}

export function intFlag(
  parsed: ParsedArgs,
  name: string,
  range?: { min: number; max: number },
): number | undefined {
  const raw = parsed.flags[name]?.[0];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new UsageError(`Flag --${name} must be an integer`);
  if (range && (value < range.min || value > range.max)) {
    throw new UsageError(`Flag --${name} must be between ${range.min} and ${range.max}`);
  }
  return value;
}

export function requireFlagOneOf(
  parsed: ParsedArgs,
  name: string,
  allowed: readonly string[],
  usage: string,
): string {
  const raw = parsed.flags[name]?.[0];
  if (raw === undefined || !allowed.includes(raw)) throw new UsageError(usage);
  return raw;
}
