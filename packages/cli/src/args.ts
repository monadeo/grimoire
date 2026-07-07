// Minimal flag parser: collects repeated --flag/-f values and positionals.
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string[]>;
  bools: Set<string>;
}

const BOOL_FLAGS = new Set(["json", "compact", "no-rerank", "watch", "errors", "private", "names"]);

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
        (flags[name] ??= []).push(argv[++i]);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags, bools };
}
