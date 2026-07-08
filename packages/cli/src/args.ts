// Minimal flag parser: collects repeated --flag/-f values and positionals.
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string[]>;
  bools: Set<string>;
}

export class UsageError extends Error {}

const BOOL_FLAGS = new Set(["json", "compact", "watch", "private", "names"]);

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
