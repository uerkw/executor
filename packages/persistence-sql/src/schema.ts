import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const tableNames = {
  profile: "profile",
  organizations: "organizations",
  organizationMemberships: "organization_memberships",
  workspaces: "workspaces",
  sources: "sources",
  toolArtifacts: "tool_artifacts",
  authConnections: "auth_connections",
  sourceAuthBindings: "source_auth_bindings",
  authMaterials: "auth_materials",
  oauthStates: "oauth_states",
  policies: "policies",
  approvals: "approvals",
  taskRuns: "task_runs",
  storageInstances: "storage_instances",
  syncStates: "sync_states",
  events: "events",
} as const;

const entityColumns = {
  id: text("id").notNull().primaryKey(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
};

const workspaceEntityColumns = {
  ...entityColumns,
  workspaceId: text("workspace_id"),
};

export const profileTable = sqliteTable(tableNames.profile, {
  id: integer("id").notNull().primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  generatedAt: integer("generated_at", { mode: "number" }).notNull(),
  profileJson: text("profile_json").notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const organizationsTable = sqliteTable(
  tableNames.organizations,
  entityColumns,
);

export const organizationMembershipsTable = sqliteTable(
  tableNames.organizationMemberships,
  workspaceEntityColumns,
);

export const workspacesTable = sqliteTable(tableNames.workspaces, workspaceEntityColumns);

export const sourcesTable = sqliteTable(
  tableNames.sources,
  {
    workspaceId: text("workspace_id").notNull(),
    sourceId: text("source_id").notNull(),
    name: text("name").notNull(),
    payloadJson: text("payload_json").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.sourceId],
    }),
    index("sources_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const toolArtifactsTable = sqliteTable(
  tableNames.toolArtifacts,
  {
    workspaceId: text("workspace_id").notNull(),
    sourceId: text("source_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.sourceId],
    }),
  ],
);

export const authConnectionsTable = sqliteTable(
  tableNames.authConnections,
  workspaceEntityColumns,
);

export const sourceAuthBindingsTable = sqliteTable(
  tableNames.sourceAuthBindings,
  workspaceEntityColumns,
);

export const authMaterialsTable = sqliteTable(
  tableNames.authMaterials,
  workspaceEntityColumns,
);

export const oauthStatesTable = sqliteTable(
  tableNames.oauthStates,
  workspaceEntityColumns,
);

export const policiesTable = sqliteTable(
  tableNames.policies,
  workspaceEntityColumns,
);

export const approvalsTable = sqliteTable(
  tableNames.approvals,
  workspaceEntityColumns,
);

export const taskRunsTable = sqliteTable(
  tableNames.taskRuns,
  workspaceEntityColumns,
);

export const storageInstancesTable = sqliteTable(
  tableNames.storageInstances,
  workspaceEntityColumns,
);

export const syncStatesTable = sqliteTable(tableNames.syncStates, workspaceEntityColumns);

export const eventsTable = sqliteTable(
  tableNames.events,
  {
    id: text("id").notNull().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventJson: text("event_json").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("events_workspace_sequence_idx").on(
      table.workspaceId,
      table.sequence,
    ),
  ],
);
