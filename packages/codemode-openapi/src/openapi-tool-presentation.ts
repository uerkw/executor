import { typeSignatureFromSchemaJson } from "@executor-v3/codemode-core";

import {
  resolveTypingSchemasWithRefHints,
} from "./openapi-schema-refs";
import type {
  OpenApiExample,
  OpenApiToolDocumentation,
  OpenApiToolManifest,
} from "./openapi-types";
import type { OpenApiToolDefinition } from "./openapi-definitions";

const parseJson = (value: string): unknown | undefined => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const firstExample = (
  examples: ReadonlyArray<OpenApiExample> | undefined,
): OpenApiExample | undefined => examples?.[0];

const buildExampleInputJson = (
  documentation: OpenApiToolDocumentation | undefined,
): string | undefined => {
  if (!documentation) {
    return undefined;
  }

  const input: Record<string, unknown> = {};

  for (const parameter of documentation.parameters) {
    const example = firstExample(parameter.examples);
    if (!example) {
      continue;
    }

    const parsedValue = parseJson(example.valueJson);
    if (parsedValue !== undefined) {
      input[parameter.name] = parsedValue;
    }
  }

  const requestBodyExample = firstExample(documentation.requestBody?.examples);
  if (requestBodyExample) {
    const parsedValue = parseJson(requestBodyExample.valueJson);
    if (parsedValue !== undefined) {
      input.body = parsedValue;
    }
  }

  return Object.keys(input).length > 0 ? JSON.stringify(input) : undefined;
};

const buildExampleOutputJson = (
  documentation: OpenApiToolDocumentation | undefined,
): string | undefined => firstExample(documentation?.response?.examples)?.valueJson;

export type OpenApiToolPresentation = {
  inputType: string;
  outputType: string;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
  exampleInputJson?: string;
  exampleOutputJson?: string;
  providerDataJson: string;
};

export const buildOpenApiToolPresentation = (input: {
  manifest: OpenApiToolManifest;
  definition: OpenApiToolDefinition;
}): OpenApiToolPresentation => {
  const resolvedSchemas = resolveTypingSchemasWithRefHints(
    input.definition.typing,
    input.manifest.refHintTable,
  );
  const inputSchemaJson = resolvedSchemas.inputSchemaJson ?? undefined;
  const outputSchemaJson = resolvedSchemas.outputSchemaJson ?? undefined;
  const exampleInputJson = buildExampleInputJson(input.definition.documentation);
  const exampleOutputJson = buildExampleOutputJson(input.definition.documentation);

  return {
    inputType: typeSignatureFromSchemaJson(inputSchemaJson, "unknown", 320),
    outputType: typeSignatureFromSchemaJson(outputSchemaJson, "unknown", 320),
    ...(inputSchemaJson ? { inputSchemaJson } : {}),
    ...(outputSchemaJson ? { outputSchemaJson } : {}),
    ...(exampleInputJson ? { exampleInputJson } : {}),
    ...(exampleOutputJson ? { exampleOutputJson } : {}),
    providerDataJson: JSON.stringify({
      kind: "openapi",
      toolId: input.definition.toolId,
      rawToolId: input.definition.rawToolId,
      operationId: input.definition.operationId,
      group: input.definition.group,
      leaf: input.definition.leaf,
      tags: input.definition.tags,
      versionSegment: input.definition.versionSegment,
      method: input.definition.method,
      path: input.definition.path,
      operationHash: input.definition.operationHash,
      documentation: input.definition.documentation,
    }),
  };
};
