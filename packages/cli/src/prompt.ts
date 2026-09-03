import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const ENTER = new Set(["\r", "\n"]);
const CTRL_C = String.fromCharCode(3);
const BACKSPACE = new Set([String.fromCharCode(127), "\b"]);

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Password entry without echo. Without a TTY (piped stdin) the first line is
// read as-is, so scripts can feed it.
export async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) return promptLine(question);
  stdout.write(question);
  return new Promise((resolve, reject) => {
    const chars: string[] = [];
    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: string | Buffer): void => {
      for (const ch of chunk.toString("utf8")) {
        if (ENTER.has(ch)) {
          cleanup();
          stdout.write("\n");
          resolve(chars.join(""));
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          stdout.write("\n");
          reject(new Error("Login cancelled"));
          return;
        }
        if (BACKSPACE.has(ch)) {
          chars.pop();
          continue;
        }
        chars.push(ch);
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
