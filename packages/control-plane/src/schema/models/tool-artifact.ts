import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import {
  toolArtifactParametersTable,
  toolArtifactRefHintKeysTable,
  toolArtifactRequestBodyContentTypesTable,
  toolArtifactsTable,
} from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import { SourceIdSchema, WorkspaceIdSchema } from "../ids";

export const ToolArtifactProviderKindSchema = Schema.Literal(
  "mcp",
  "openapi",
);

export const ToolArtifactParameterLocationSchema = Schema.Literal(
  "path",
  "query",
  "header",
  "cookie",
);

const toolArtifactRowSchemaOverrides = {
  workspaceId: WorkspaceIdSchema,
  sourceId: SourceIdSchema,
  providerKind: ToolArtifactProviderKindSchema,
  openApiMethod: Schema.NullOr(
    Schema.Literal("get", "put", "post", "delete", "patch", "head", "options", "trace"),
  ),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

const ToolArtifactStorageRowSchema = createSelectSchema(
  toolArtifactsTable,
  toolArtifactRowSchemaOverrides,
);

export const StoredToolArtifactRecordSchema = Schema.Struct({
  workspaceId: WorkspaceIdSchema,
  path: Schema.String,
  toolId: Schema.String,
  sourceId: SourceIdSchema,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  searchNamespace: Schema.String,
  searchText: Schema.String,
  inputSchemaJson: Schema.NullOr(Schema.String),
  outputSchemaJson: Schema.NullOr(Schema.String),
  providerKind: ToolArtifactProviderKindSchema,
  mcpToolName: Schema.NullOr(Schema.String),
  openApiMethod: Schema.NullOr(
    Schema.Literal("get", "put", "post", "delete", "patch", "head", "options", "trace"),
  ),
  openApiPathTemplate: Schema.NullOr(Schema.String),
  openApiOperationHash: Schema.NullOr(Schema.String),
  openApiRequestBodyRequired: Schema.NullOr(Schema.Boolean),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
}).annotations({
  identifier: "StoredToolArtifactRecord",
});

export const ToolArtifactStorageSchema = Schema.transform(
  ToolArtifactStorageRowSchema,
  StoredToolArtifactRecordSchema,
  {
    strict: false,
    decode: (row) => ({
      workspaceId: row.workspaceId,
      path: row.path,
      toolId: row.toolId,
      sourceId: row.sourceId,
      title: row.title,
      description: row.description,
      searchNamespace: row.searchNamespace,
      searchText: row.searchText,
      inputSchemaJson: row.inputSchemaJson,
      outputSchemaJson: row.outputSchemaJson,
      providerKind: row.providerKind,
      mcpToolName: row.mcpToolName,
      openApiMethod: row.openApiMethod,
      openApiPathTemplate: row.openApiPathTemplate,
      openApiOperationHash: row.openApiOperationHash,
      openApiRequestBodyRequired: row.openApiRequestBodyRequired,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    encode: (record) => ({
      workspaceId: record.workspaceId,
      path: record.path,
      toolId: record.toolId,
      sourceId: record.sourceId,
      title: record.title,
      description: record.description,
      searchNamespace: record.searchNamespace,
      searchText: record.searchText,
      inputSchemaJson: record.inputSchemaJson,
      outputSchemaJson: record.outputSchemaJson,
      providerKind: record.providerKind,
      mcpToolName: record.mcpToolName,
      openApiMethod: record.openApiMethod,
      openApiPathTemplate: record.openApiPathTemplate,
      openApiOperationHash: record.openApiOperationHash,
      openApiRequestBodyRequired: record.openApiRequestBodyRequired,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }),
  },
);

const toolArtifactParameterRowSchemaOverrides = {
  workspaceId: WorkspaceIdSchema,
  location: ToolArtifactParameterLocationSchema,
  position: Schema.Number,
} as const;

export const StoredToolArtifactParameterRecordSchema = createSelectSchema(
  toolArtifactParametersTable,
  toolArtifactParameterRowSchemaOverrides,
).annotations({
  identifier: "StoredToolArtifactParameterRecord",
});

const toolArtifactRequestBodyContentTypeRowSchemaOverrides = {
  workspaceId: WorkspaceIdSchema,
  position: Schema.Number,
} as const;

export const StoredToolArtifactRequestBodyContentTypeRecordSchema = createSelectSchema(
  toolArtifactRequestBodyContentTypesTable,
  toolArtifactRequestBodyContentTypeRowSchemaOverrides,
).annotations({
  identifier: "StoredToolArtifactRequestBodyContentTypeRecord",
});

const toolArtifactRefHintKeyRowSchemaOverrides = {
  workspaceId: WorkspaceIdSchema,
  position: Schema.Number,
} as const;

export const StoredToolArtifactRefHintKeyRecordSchema = createSelectSchema(
  toolArtifactRefHintKeysTable,
  toolArtifactRefHintKeyRowSchemaOverrides,
).annotations({
  identifier: "StoredToolArtifactRefHintKeyRecord",
});

export type ToolArtifactProviderKind = typeof ToolArtifactProviderKindSchema.Type;
export type ToolArtifactParameterLocation = typeof ToolArtifactParameterLocationSchema.Type;
export type StoredToolArtifactRecord = typeof StoredToolArtifactRecordSchema.Type;
export type StoredToolArtifactParameterRecord =
  typeof StoredToolArtifactParameterRecordSchema.Type;
export type StoredToolArtifactRequestBodyContentTypeRecord =
  typeof StoredToolArtifactRequestBodyContentTypeRecordSchema.Type;
export type StoredToolArtifactRefHintKeyRecord =
  typeof StoredToolArtifactRefHintKeyRecordSchema.Type;
