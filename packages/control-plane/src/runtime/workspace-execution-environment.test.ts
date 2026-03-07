import { randomUUID } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it } from "@effect/vitest";
import {
  AccountIdSchema,
  ExecutionIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import { z } from "zod/v4";

import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "#persistence";
import type { SourceId, WorkspaceId } from "#schema";

import type { RuntimeSourceAuthService } from "./source-auth-service";
import { createWorkspaceExecutionEnvironmentResolver } from "./workspace-execution-environment";

type CountedMcpServer = {
  endpoint: string;
  counts: {
    listTools: number;
    callTool: number;
  };
  close: () => Promise<void>;
};

const makePersistence = Effect.acquireRelease(
  createSqlControlPlanePersistence({
    localDataDir: ":memory:",
  }),
  (persistence) =>
    Effect.tryPromise({
      try: () => persistence.close(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
);

const makeCountedMcpServer = Effect.acquireRelease(
  Effect.promise<CountedMcpServer>(
    () =>
      new Promise<CountedMcpServer>((resolve, reject) => {
        const counts = {
          listTools: 0,
          callTool: 0,
        };
        let closed = false;
        const app = createMcpExpressApp({ host: "127.0.0.1" });
        const transports: Record<string, StreamableHTTPServerTransport> = {};
        const servers: Record<string, McpServer> = {};

        const createServer = () => {
          const server = new McpServer(
            {
              name: "workspace-execution-environment-test-server",
              version: "1.0.0",
            },
            {
              capabilities: {
                tools: {},
              },
            },
          );

          server.registerTool(
            "echo",
            {
              description: "Echo the provided string",
              inputSchema: {
                value: z.string(),
              },
            },
            async ({ value }: { value: string }) => ({
              content: [{ type: "text", text: `echo:${value}` }],
            }),
          );

          return server;
        };

        const countMethods = (body: unknown) => {
          const payloads = Array.isArray(body) ? body : [body];
          for (const payload of payloads) {
            if (!payload || typeof payload !== "object") {
              continue;
            }

            const method = "method" in payload ? payload.method : undefined;
            if (method === "tools/list") {
              counts.listTools += 1;
            } else if (method === "tools/call") {
              counts.callTool += 1;
            }
          }
        };

        app.post("/mcp", async (req: any, res: any) => {
          countMethods(req.body);

          const sessionIdHeader = req.headers["mcp-session-id"];
          const sessionId =
            typeof sessionIdHeader === "string"
              ? sessionIdHeader
              : Array.isArray(sessionIdHeader)
                ? sessionIdHeader[0]
                : undefined;

          try {
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
              transport = transports[sessionId];
            } else {
              transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (newSessionId) => {
                  transports[newSessionId] = transport;
                },
              });

              transport.onclose = () => {
                const closedSessionId = transport.sessionId;
                if (closedSessionId && transports[closedSessionId]) {
                  delete transports[closedSessionId];
                }
                if (closedSessionId && servers[closedSessionId]) {
                  void servers[closedSessionId].close().catch(() => undefined);
                  delete servers[closedSessionId];
                }
              };

              const server = createServer();
              await server.connect(transport);
              const newSessionId = transport.sessionId;
              if (newSessionId) {
                servers[newSessionId] = server;
              }
            }

            await transport.handleRequest(req, res, req.body);
          } catch (error) {
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message:
                    error instanceof Error ? error.message : "Internal server error",
                },
                id: null,
              });
            }
          }
        });

        app.get("/mcp", async (req: any, res: any) => {
          const sessionIdHeader = req.headers["mcp-session-id"];
          const sessionId =
            typeof sessionIdHeader === "string"
              ? sessionIdHeader
              : Array.isArray(sessionIdHeader)
                ? sessionIdHeader[0]
                : undefined;

          if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
          }

          await transports[sessionId].handleRequest(req, res);
        });

        app.delete("/mcp", async (req: any, res: any) => {
          const sessionIdHeader = req.headers["mcp-session-id"];
          const sessionId =
            typeof sessionIdHeader === "string"
              ? sessionIdHeader
              : Array.isArray(sessionIdHeader)
                ? sessionIdHeader[0]
                : undefined;

          if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
          }

          const transport = transports[sessionId];
          await transport.handleRequest(req, res, req.body);
          await transport.close();
          delete transports[sessionId];

          if (servers[sessionId]) {
            await servers[sessionId].close().catch(() => undefined);
            delete servers[sessionId];
          }
        });

        const listener = app.listen(0, "127.0.0.1", () => {
          const address = listener.address();
          if (!address || typeof address === "string") {
            reject(new Error("failed to resolve MCP test server address"));
            return;
          }

          resolve({
            endpoint: `http://127.0.0.1:${address.port}/mcp`,
            counts,
            close: async () => {
              if (closed) {
                return;
              }
              closed = true;

              for (const transport of Object.values(transports)) {
                await transport.close().catch(() => undefined);
              }

              for (const server of Object.values(servers)) {
                await server.close().catch(() => undefined);
              }

              await new Promise<void>((closeResolve, closeReject) => {
                listener.close((error: Error | undefined) => {
                  if (error) {
                    closeReject(error);
                    return;
                  }
                  closeResolve();
                });
              });
            },
          });
        });

        listener.once("error", reject);
      }),
  ),
  (server) =>
    Effect.tryPromise({
      try: () => server.close(),
      catch: (error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.orDie),
);

const persistConnectedEchoTool = (input: {
  persistence: SqlControlPlanePersistence;
  endpoint: string;
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.gen(function* () {
    const now = Date.now();

    yield* input.persistence.rows.sources.insert({
      id: input.sourceId,
      workspaceId: input.workspaceId,
      name: "Counted MCP",
      kind: "mcp",
      endpoint: input.endpoint,
      status: "connected",
      enabled: true,
      namespace: "counted",
      transport: "auto",
      queryParamsJson: null,
      headersJson: null,
      specUrl: null,
      defaultHeadersJson: null,
      authKind: "none",
      authHeaderName: null,
      authPrefix: null,
      sourceHash: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    yield* input.persistence.rows.toolArtifacts.replaceForSource({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      artifacts: [{
        artifact: {
          workspaceId: input.workspaceId,
          path: "counted.echo",
          toolId: "echo",
          sourceId: input.sourceId,
          title: "echo",
          description: "Echo the provided string",
          searchNamespace: "counted.echo",
          searchText: "counted.echo echo provided string",
          inputSchemaJson: JSON.stringify({
            type: "object",
            properties: {
              value: {
                type: "string",
              },
            },
            required: ["value"],
            additionalProperties: false,
          }),
          outputSchemaJson: null,
          providerKind: "mcp",
          mcpToolName: "echo",
          openApiMethod: null,
          openApiPathTemplate: null,
          openApiOperationHash: null,
          openApiRequestBodyRequired: null,
          createdAt: now,
          updatedAt: now,
        },
      }],
    });
  });

const makeResolver = (persistence: SqlControlPlanePersistence) =>
  createWorkspaceExecutionEnvironmentResolver({
    rows: persistence.rows,
    sourceAuthService: {
      getSourceById: () => Effect.fail(new Error("not implemented in test")),
      addExecutorMcpSource: () => Effect.fail(new Error("not implemented in test")),
      completeSourceAuthCallback: () => Effect.fail(new Error("not implemented in test")),
    } as RuntimeSourceAuthService,
  });

describe("workspace-execution-environment", () => {
  it.scoped("discovers persisted tools without live MCP listing", () =>
    Effect.gen(function* () {
      const server = yield* makeCountedMcpServer;
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_catalog");
      const sourceId = SourceIdSchema.make("src_catalog");
      yield* persistConnectedEchoTool({
        persistence,
        endpoint: server.endpoint,
        workspaceId,
        sourceId,
      });

      yield* Effect.tryPromise({
        try: () => server.close(),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.orDie);

      const resolveEnvironment = makeResolver(persistence);
      const environment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_catalog"),
        executionId: ExecutionIdSchema.make("exec_catalog"),
      });

      const discovered = (yield* environment.toolInvoker.invoke({
        path: "discover",
        args: {
          query: "echo string",
          limit: 5,
        },
      })) as {
        bestPath: string | null;
        total: number;
        results: Array<{ path: string }>;
      };

      expect(discovered.bestPath).toBe("counted.echo");
      expect(discovered.total).toBeGreaterThan(0);
      expect(server.counts.listTools).toBe(0);
      expect(server.counts.callTool).toBe(0);
    }),
  );

  it.scoped("invokes persisted MCP tools on demand without re-listing", () =>
    Effect.gen(function* () {
      const server = yield* makeCountedMcpServer;
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_invoke");
      const sourceId = SourceIdSchema.make("src_invoke");
      yield* persistConnectedEchoTool({
        persistence,
        endpoint: server.endpoint,
        workspaceId,
        sourceId,
      });

      const resolveEnvironment = makeResolver(persistence);
      const environment = yield* resolveEnvironment({
        workspaceId,
        accountId: AccountIdSchema.make("acc_invoke"),
        executionId: ExecutionIdSchema.make("exec_invoke"),
      });

      const result = (yield* environment.toolInvoker.invoke({
        path: "counted.echo",
        args: {
          value: "hello",
        },
      })) as {
        content?: Array<{ text?: string }>;
      };

      expect(server.counts.listTools).toBe(0);
      expect(server.counts.callTool).toBe(1);
      expect(result.content?.[0]?.text).toBe("echo:hello");
    }),
  );
});
