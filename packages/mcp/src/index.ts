import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { ApiError } from "@monadeo.com/grimoire-core";
import { TOOLS, rewriteArgs } from "./tools.js";

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "grimoire", version: "0.1.0" },
    {
      instructions:
        "Use grimoire for any question about a library, framework, or tool — even when you think you know the answer, to get version-correct docs. Not for refactoring, business logic, or code review.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (rawArgs: Record<string, unknown>) => {
        try {
          const text = await tool.handler(rewriteArgs(rawArgs, Object.keys(tool.schema)));
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          const message =
            err instanceof ApiError
              ? err.status === 401
                ? "Not authenticated — the user should run `grimoire login`."
                : err.status === 429
                  ? "Quota or rate limit reached — inform the user; do not retry."
                  : err.status === 404
                    ? `Not found: ${JSON.stringify(err.body)}`
                    : `Grimoire error: ${err.code}`
              : `Error: ${(err as Error).message}`;
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
  return server;
}

async function runStdio(): Promise<void> {
  await buildServer().connect(new StdioServerTransport());
}

function runHttp(port: number): void {
  const app = express();
  app.use(express.json());
  // Fresh server + transport per request; session lifecycle owned by the client.
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: ["127.0.0.1", `127.0.0.1:${port}`, "localhost", `localhost:${port}`],
    });
    res.on("close", () => void transport.close());
    await buildServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => res.status(405).end()); // no server-initiated SSE
  app.listen(port, "127.0.0.1");
}

if (process.argv.includes("--http")) {
  runHttp(Number(process.env.PORT ?? 8080));
} else {
  void runStdio();
}
