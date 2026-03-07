import {
  createSystemToolMap,
  createToolCatalogFromTools,
  makeToolInvokerFromTools,
  type SearchHit,
  type ToolCatalog,
  type ToolDescriptor,
  type ToolInvoker,
  type ToolNamespace,
  type ToolPath,
} from "@executor-v3/codemode-core";
import {
  createSdkMcpConnector,
  createMcpToolsFromManifest,
} from "@executor-v3/codemode-mcp";
import {
  createOpenApiToolsFromManifest,
} from "@executor-v3/codemode-openapi";
import { makeInProcessExecutor } from "@executor-v3/runtime-local-inproc";
import {
  SqlControlPlaneRowsService,
  type SqlControlPlaneRows,
} from "#persistence";
import type {
  Source,
  StoredToolArtifactRecord,
} from "#schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type {
  ExecutionEnvironment,
  ResolveExecutionEnvironment,
} from "./execution-state";
import { createExecutorToolMap } from "./executor-tools";
import { projectSourceFromStorage } from "./source-definitions";
import {
  RuntimeSourceAuthServiceTag,
  createDbBackedSecretMaterialResolver,
  type ResolveSecretMaterial,
  type RuntimeSourceAuthService,
} from "./source-auth-service";
import {
  createEnvSecretMaterialResolver,
  namespaceFromSourceName,
  resolveSourceAuthMaterial,
  storedToolIdFromArtifact,
} from "./tool-artifacts";

const asToolPath = (value: string): ToolPath => value as ToolPath;

const tokenize = (value: string): string[] =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const scoreArtifact = (
  queryTokens: readonly string[],
  searchText: string,
): number =>
  queryTokens.reduce(
    (total, token) => total + (searchText.includes(token) ? 1 : 0),
    0,
  );

const toDescriptor = (input: {
  artifact: StoredToolArtifactRecord;
  includeSchemas: boolean;
  refHintKeys?: readonly string[];
}): ToolDescriptor => ({
  path: asToolPath(input.artifact.path),
  sourceKey: input.artifact.sourceId,
  description: input.artifact.description ?? input.artifact.title ?? undefined,
  interaction: "auto",
  inputHint: input.artifact.inputSchemaJson ? "object" : undefined,
  outputHint: input.artifact.outputSchemaJson ? "output" : undefined,
  inputSchemaJson: input.includeSchemas ? input.artifact.inputSchemaJson ?? undefined : undefined,
  outputSchemaJson: input.includeSchemas ? input.artifact.outputSchemaJson ?? undefined : undefined,
  refHintKeys: input.includeSchemas ? input.refHintKeys : undefined,
});

const loadSourceById = (input: {
  rows: SqlControlPlaneRows;
  workspaceId: Source["workspaceId"];
  sourceId: Source["id"];
}): Effect.Effect<Source, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* input.rows.sources.getByWorkspaceAndId(
      input.workspaceId,
      input.sourceId,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(`Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`),
      );
    }

    const credentialBinding = yield* input.rows.sourceCredentialBindings
      .getByWorkspaceAndSourceId(input.workspaceId, input.sourceId)
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    return yield* projectSourceFromStorage({
      sourceRecord: sourceRecord.value,
      credentialBinding: Option.isSome(credentialBinding) ? credentialBinding.value : null,
    });
  });

const createWorkspaceToolCatalog = (input: {
  workspaceId: Source["workspaceId"];
  rows: SqlControlPlaneRows;
  executorCatalog: ToolCatalog;
}): ToolCatalog => ({
  listNamespaces: ({ limit }) =>
    Effect.gen(function* () {
      const [persisted, executor] = yield* Effect.all([
        input.rows.toolArtifacts.listNamespacesByWorkspaceId(input.workspaceId, {
          limit,
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        ),
        input.executorCatalog.listNamespaces({ limit }),
      ]);

      const merged = new Map<string, ToolNamespace>();
      for (const namespace of persisted) {
        merged.set(namespace.namespace, namespace);
      }
      for (const namespace of executor) {
        const existing = merged.get(namespace.namespace);
        merged.set(namespace.namespace, {
          namespace: namespace.namespace,
          displayName: namespace.displayName ?? existing?.displayName,
          toolCount:
            namespace.toolCount !== undefined || existing?.toolCount === undefined
              ? namespace.toolCount
              : existing.toolCount,
        });
      }

      return [...merged.values()]
        .sort((left, right) => left.namespace.localeCompare(right.namespace))
        .slice(0, limit);
    }),

  listTools: ({ namespace, query, limit, includeSchemas = false }) =>
    Effect.gen(function* () {
      const [persisted, executor] = yield* Effect.all([
        namespace?.startsWith("executor")
          ? Effect.succeed([] as readonly StoredToolArtifactRecord[])
          : input.rows.toolArtifacts.listByWorkspaceId(input.workspaceId, {
              namespace,
              query,
              limit,
            }).pipe(
              Effect.mapError((cause) =>
                cause instanceof Error ? cause : new Error(String(cause)),
              ),
            ),
        input.executorCatalog.listTools({
          ...(namespace !== undefined ? { namespace } : {}),
          ...(query !== undefined ? { query } : {}),
          limit,
          includeSchemas,
        }),
      ]);

      const persistedDescriptors = includeSchemas
        ? yield* Effect.forEach(
            persisted,
            (artifact) =>
              input.rows.toolArtifacts.listRefHintKeysByWorkspaceAndPath(
                input.workspaceId,
                artifact.path,
              ).pipe(
                Effect.map((rows) =>
                  toDescriptor({
                    artifact,
                    includeSchemas,
                    refHintKeys: rows.map((row) => row.refHintKey),
                  })
                ),
                Effect.mapError((cause) =>
                  cause instanceof Error ? cause : new Error(String(cause)),
                ),
              ),
            { concurrency: "unbounded" },
          )
        : persisted.map((artifact) =>
            toDescriptor({
              artifact,
              includeSchemas,
            })
          );

      return [...persistedDescriptors, ...executor]
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, limit);
    }),

  getToolByPath: ({ path, includeSchemas }) =>
    Effect.gen(function* () {
      const executor = yield* input.executorCatalog.getToolByPath({
        path,
        includeSchemas,
      });
      if (executor) {
        return executor;
      }

      const artifact = yield* input.rows.toolArtifacts.getByWorkspaceAndPath(
        input.workspaceId,
        path,
      ).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

      if (Option.isNone(artifact)) {
        return null;
      }

      const refHintKeys = includeSchemas
        ? yield* input.rows.toolArtifacts.listRefHintKeysByWorkspaceAndPath(
            input.workspaceId,
            path,
          ).pipe(
            Effect.map((rows) => rows.map((row) => row.refHintKey)),
            Effect.mapError((cause) =>
              cause instanceof Error ? cause : new Error(String(cause)),
            ),
          )
        : undefined;

      return toDescriptor({
        artifact: artifact.value,
        includeSchemas,
        refHintKeys,
      });
    }),

  searchTools: ({ query, namespace, limit }) =>
    Effect.gen(function* () {
      const queryTokens = tokenize(query);
      const [persisted, executor] = yield* Effect.all([
        namespace?.startsWith("executor")
          ? Effect.succeed([] as readonly StoredToolArtifactRecord[])
          : input.rows.toolArtifacts.searchByWorkspaceId(input.workspaceId, {
              namespace,
              query,
              limit: Math.max(limit * 8, 50),
            }).pipe(
              Effect.mapError((cause) =>
                cause instanceof Error ? cause : new Error(String(cause)),
              ),
            ),
        input.executorCatalog.searchTools({
          query,
          ...(namespace !== undefined ? { namespace } : {}),
          limit,
        }),
      ]);

      const persistedHits: SearchHit[] = persisted
        .map((artifact) => ({
          path: asToolPath(artifact.path),
          score: scoreArtifact(queryTokens, artifact.searchText),
        }))
        .filter((hit) => hit.score > 0);

      return [...persistedHits, ...executor]
        .sort((left, right) =>
          right.score - left.score || left.path.localeCompare(right.path),
        )
        .slice(0, limit);
    }),
});

const createWorkspaceToolInvoker = (input: {
  workspaceId: Source["workspaceId"];
  rows: SqlControlPlaneRows;
  resolveSecretMaterial: ResolveSecretMaterial;
  sourceAuthService: RuntimeSourceAuthService;
  onElicitation?: Parameters<typeof makeToolInvokerFromTools>[0]["onElicitation"];
}): {
  catalog: ToolCatalog;
  toolInvoker: ToolInvoker;
} => {
  const executorTools = createExecutorToolMap({
    workspaceId: input.workspaceId,
    sourceAuthService: input.sourceAuthService,
  });
  const executorCatalog = createToolCatalogFromTools({
    tools: executorTools,
  });
  const catalog = createWorkspaceToolCatalog({
    workspaceId: input.workspaceId,
    rows: input.rows,
    executorCatalog,
  });
  const systemTools = createSystemToolMap({ catalog });
  const systemToolPaths = new Set(Object.keys(systemTools));
  const executorToolPaths = new Set(Object.keys(executorTools));
  const systemInvoker = makeToolInvokerFromTools({
    tools: systemTools,
    onElicitation: input.onElicitation,
  });
  const executorInvoker = makeToolInvokerFromTools({
    tools: executorTools,
    onElicitation: input.onElicitation,
  });

  const invokePersistedTool = (invocation: {
    path: string;
    args: unknown;
    context?: Record<string, unknown>;
  }) =>
    Effect.gen(function* () {
      const artifactOption = yield* input.rows.toolArtifacts
        .getByWorkspaceAndPath(input.workspaceId, invocation.path)
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        );

      if (Option.isNone(artifactOption)) {
        return yield* Effect.fail(new Error(`Unknown tool path: ${invocation.path}`));
      }

      const artifact = artifactOption.value;
      const source = yield* loadSourceById({
        rows: input.rows,
        workspaceId: input.workspaceId,
        sourceId: artifact.sourceId,
      });

      if (!source.enabled || source.status !== "connected") {
        return yield* Effect.fail(
          new Error(`Source for tool path ${invocation.path} is not connected`),
        );
      }

      const auth = yield* resolveSourceAuthMaterial({
        source,
        resolveSecretMaterial: input.resolveSecretMaterial,
      });

      if (artifact.providerKind === "mcp") {
        const tools = createMcpToolsFromManifest({
          manifest: {
            version: 1,
            tools: [{
              toolId: storedToolIdFromArtifact(artifact),
              toolName: artifact.mcpToolName ?? artifact.title ?? artifact.path,
              description: artifact.description ?? null,
              ...(artifact.inputSchemaJson ? { inputSchemaJson: artifact.inputSchemaJson } : {}),
              ...(artifact.outputSchemaJson ? { outputSchemaJson: artifact.outputSchemaJson } : {}),
            }],
          },
          connect: createSdkMcpConnector({
            endpoint: source.endpoint,
            transport: source.transport ?? undefined,
            queryParams: source.queryParams ?? undefined,
            headers: {
              ...(source.headers ?? {}),
              ...auth.headers,
            },
          }),
          namespace: source.namespace ?? namespaceFromSourceName(source.name),
          sourceKey: source.id,
        });

        return yield* makeToolInvokerFromTools({
          tools,
          onElicitation: input.onElicitation,
        }).invoke({
          path: invocation.path,
          args: invocation.args,
          context: invocation.context,
        });
      }

      if (artifact.providerKind === "openapi") {
        const [parameters, requestBodyContentTypes, refHintKeys] = yield* Effect.all([
          input.rows.toolArtifacts.listParametersByWorkspaceAndPath(
            input.workspaceId,
            artifact.path,
          ),
          input.rows.toolArtifacts.listRequestBodyContentTypesByWorkspaceAndPath(
            input.workspaceId,
            artifact.path,
          ),
          input.rows.toolArtifacts.listRefHintKeysByWorkspaceAndPath(
            input.workspaceId,
            artifact.path,
          ),
        ]).pipe(
          Effect.mapError((cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        );

        const tools = createOpenApiToolsFromManifest({
          manifest: {
            version: 1,
            sourceHash: source.sourceHash ?? "stored",
            tools: [{
              toolId: storedToolIdFromArtifact(artifact),
              name: artifact.title ?? storedToolIdFromArtifact(artifact),
              description: artifact.description ?? null,
              method: artifact.openApiMethod!,
              path: artifact.openApiPathTemplate!,
              invocation: {
                method: artifact.openApiMethod!,
                pathTemplate: artifact.openApiPathTemplate!,
                parameters: parameters.map((parameter) => ({
                  name: parameter.name,
                  location: parameter.location,
                  required: parameter.required,
                })),
                requestBody:
                  artifact.openApiRequestBodyRequired === null
                    ? null
                    : {
                        required: artifact.openApiRequestBodyRequired,
                        contentTypes: requestBodyContentTypes.map((row) => row.contentType),
                      },
              },
              operationHash: artifact.openApiOperationHash!,
              typing: {
                ...(artifact.inputSchemaJson ? { inputSchemaJson: artifact.inputSchemaJson } : {}),
                ...(artifact.outputSchemaJson ? { outputSchemaJson: artifact.outputSchemaJson } : {}),
                ...(refHintKeys.length > 0
                  ? { refHintKeys: refHintKeys.map((row) => row.refHintKey) }
                  : {}),
              },
            }],
          },
          baseUrl: source.endpoint,
          namespace: source.namespace ?? namespaceFromSourceName(source.name),
          sourceKey: source.id,
          defaultHeaders: source.defaultHeaders ?? {},
          credentialHeaders: auth.headers,
        });

        return yield* makeToolInvokerFromTools({
          tools,
          onElicitation: input.onElicitation,
        }).invoke({
          path: invocation.path,
          args: invocation.args,
          context: invocation.context,
        });
      }

      return yield* Effect.fail(
        new Error(`Unsupported stored tool provider for ${invocation.path}`),
      );
    });

  return {
    catalog,
    toolInvoker: {
      invoke: ({ path, args, context }) =>
        systemToolPaths.has(path)
          ? systemInvoker.invoke({ path, args, context })
          : executorToolPaths.has(path)
            ? executorInvoker.invoke({ path, args, context })
            : invokePersistedTool({ path, args, context }),
    },
  };
};

export const createWorkspaceExecutionEnvironmentResolver = (input: {
  rows: SqlControlPlaneRows;
  resolveSecretMaterial?: ResolveSecretMaterial;
  sourceAuthService: RuntimeSourceAuthService;
}): ResolveExecutionEnvironment => {
  const resolveSecretMaterial =
    input.resolveSecretMaterial
    ?? createDbBackedSecretMaterialResolver({
      rows: input.rows,
      fallback: createEnvSecretMaterialResolver(),
    });

  return ({ workspaceId, onElicitation }) =>
    Effect.sync(() => {
      const { catalog, toolInvoker } = createWorkspaceToolInvoker({
        workspaceId,
        rows: input.rows,
        resolveSecretMaterial,
        sourceAuthService: input.sourceAuthService,
        onElicitation,
      });

      return {
        executor: makeInProcessExecutor(),
        toolInvoker,
        catalog,
      } satisfies ExecutionEnvironment;
    });
};

export class RuntimeExecutionResolverService extends Context.Tag(
  "#runtime/RuntimeExecutionResolverService",
)<
  RuntimeExecutionResolverService,
  ReturnType<typeof createWorkspaceExecutionEnvironmentResolver>
>() {}

export const RuntimeExecutionResolverLive = (input: {
  executionResolver?: ResolveExecutionEnvironment;
  resolveSecretMaterial?: ResolveSecretMaterial;
} = {}) =>
  input.executionResolver
    ? Layer.succeed(RuntimeExecutionResolverService, input.executionResolver)
    : Layer.effect(
        RuntimeExecutionResolverService,
        Effect.gen(function* () {
          const rows = yield* SqlControlPlaneRowsService;
          const sourceAuthService = yield* RuntimeSourceAuthServiceTag;

          return createWorkspaceExecutionEnvironmentResolver({
            rows,
            sourceAuthService,
            resolveSecretMaterial: input.resolveSecretMaterial,
          });
        }),
      );
