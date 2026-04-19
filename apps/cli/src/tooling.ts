import * as Effect from "effect/Effect";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const TOOL_PATH_TOKEN = /^[A-Za-z0-9._-]+$/;

const toToolPathSegments = (parts: ReadonlyArray<string>): ReadonlyArray<string> =>
  parts
    .flatMap((part) => part.split("."))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const isPrefixOf = (prefix: ReadonlyArray<string>, path: ReadonlyArray<string>): boolean =>
  prefix.every((segment, index) => path[index] === segment);

export interface ToolPathChildEntry {
  readonly segment: string;
  readonly invokable: boolean;
  readonly hasChildren: boolean;
  readonly toolCount: number;
}

export interface ToolPathInspection {
  readonly prefixSegments: ReadonlyArray<string>;
  readonly exactPath: string | undefined;
  readonly matchingToolCount: number;
  readonly children: ReadonlyArray<ToolPathChildEntry>;
}

export const inspectToolPath = (input: {
  toolPaths: ReadonlyArray<string>;
  rawPrefixParts: ReadonlyArray<string>;
}): ToolPathInspection => {
  const prefixSegments =
    input.rawPrefixParts.length === 0 ? [] : buildToolPath(input.rawPrefixParts).split(".");
  const children = new Map<string, { invokable: boolean; hasChildren: boolean; toolCount: number }>();
  let exactPath: string | undefined = undefined;
  let matchingToolCount = 0;

  for (const path of input.toolPaths) {
    const segments = toToolPathSegments([path]);
    if (segments.length === 0 || !isPrefixOf(prefixSegments, segments)) {
      continue;
    }

    matchingToolCount += 1;

    if (segments.length === prefixSegments.length) {
      exactPath = exactPath ?? segments.join(".");
      continue;
    }

    const childSegment = segments[prefixSegments.length];
    if (!childSegment) continue;

    const existing = children.get(childSegment) ?? {
      invokable: false,
      hasChildren: false,
      toolCount: 0,
    };
    children.set(childSegment, {
      invokable: existing.invokable || segments.length === prefixSegments.length + 1,
      hasChildren: existing.hasChildren || segments.length > prefixSegments.length + 1,
      toolCount: existing.toolCount + 1,
    });
  }

  const sortedChildren: ReadonlyArray<ToolPathChildEntry> = [...children.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, value]) => ({
      segment,
      invokable: value.invokable,
      hasChildren: value.hasChildren,
      toolCount: value.toolCount,
    }));

  return {
    prefixSegments,
    exactPath,
    matchingToolCount,
    children: sortedChildren,
  };
};

export const buildToolPath = (parts: ReadonlyArray<string>): string => {
  const segments = toToolPathSegments(parts);
  if (segments.length === 0) {
    throw new Error("Tool path must include at least one segment");
  }
  if (segments.some((segment) => !TOOL_PATH_TOKEN.test(segment))) {
    throw new Error(
      "Tool path segments must contain only letters, numbers, '.', '_' or '-'",
    );
  }
  return segments.join(".");
};

const buildToolAccessExpression = (toolPath: string): string => {
  const segments = toToolPathSegments([toolPath]);
  if (segments.length === 0) {
    throw new Error("Tool path must include at least one segment");
  }
  return segments.map((segment) => `[${JSON.stringify(segment)}]`).join("");
};

export const parseJsonObjectInput = (
  raw: string | undefined,
): Effect.Effect<Record<string, unknown>, Error> =>
  Effect.gen(function* () {
    if (raw === undefined || raw.trim().length === 0) {
      return {};
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        cause instanceof Error
          ? new Error(`Invalid JSON arguments: ${cause.message}`)
          : new Error(`Invalid JSON arguments: ${String(cause)}`),
    });

    if (!isRecord(parsed)) {
      return yield* Effect.fail(new Error("Tool arguments must decode to a JSON object"));
    }

    return parsed;
  });

export const extractExecutionResult = (structured: unknown): unknown => {
  if (!isRecord(structured) || !("result" in structured)) {
    return null;
  }
  return structured.result;
};

export const extractExecutionId = (structured: unknown): string | undefined => {
  if (!isRecord(structured) || typeof structured.executionId !== "string") {
    return undefined;
  }
  return structured.executionId;
};

export const buildSearchToolsCode = (input: {
  query: string;
  namespace?: string;
  limit: number;
}): string => {
  const payload: Record<string, unknown> = {
    query: input.query,
    limit: input.limit,
  };
  if (input.namespace && input.namespace.trim().length > 0) {
    payload.namespace = input.namespace;
  }
  return `return await tools.search(${JSON.stringify(payload)});`;
};

export const buildListSourcesCode = (input: { query?: string; limit: number }): string => {
  const payload: Record<string, unknown> = {
    limit: input.limit,
  };
  if (input.query && input.query.trim().length > 0) {
    payload.query = input.query;
  }
  return `return await tools.executor.sources.list(${JSON.stringify(payload)});`;
};

export const buildDescribeToolCode = (toolPath: string): string =>
  `return await tools.describe.tool({ path: ${JSON.stringify(toolPath)} });`;

export const buildInvokeToolCode = (toolPath: string, args: Record<string, unknown>): string => {
  const access = buildToolAccessExpression(toolPath);
  return [
    `const __toolPath = ${JSON.stringify(toolPath)};`,
    `const __args = ${JSON.stringify(args, null, 2)};`,
    `const __target = tools${access};`,
    `if (typeof __target !== "function") {`,
    "  throw new Error(`Tool not found: ${__toolPath}`);",
    "}",
    "return await __target(__args);",
  ].join("\n");
};
