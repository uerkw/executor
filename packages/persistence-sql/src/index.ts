import {
  RowStoreError,
  SourceStoreError,
  ToolArtifactStoreError,
  type SourceStore,
  type ToolArtifactStore,
} from "@executor-v2/persistence-ports";
import {
  ApprovalSchema,
  AuthConnectionSchema,
  AuthMaterialSchema,
  OAuthStateSchema,
  OrganizationMembershipSchema,
  OrganizationSchema,
  PolicySchema,
  ProfileSchema,
  SourceAuthBindingSchema,
  SourceSchema,
  StorageInstanceSchema,
  SyncStateSchema,
  TaskRunSchema,
  ToolArtifactSchema,
  WorkspaceSchema,
  type Approval,
  type AuthConnection,
  type AuthMaterial,
  type OAuthState,
  type Organization,
  type OrganizationMembership,
  type Policy,
  type Profile,
  type Source,
  type SourceAuthBinding,
  type SourceId,
  type StorageInstance,
  type SyncState,
  type TaskRun,
  type ToolArtifact,
  type Workspace,
  type WorkspaceId,
} from "@executor-v2/schema";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { migrate as migratePgProxy } from "drizzle-orm/pg-proxy/migrator";
import { drizzle as drizzlePgProxy } from "drizzle-orm/pg-proxy";
import { drizzle as drizzleSqliteProxy } from "drizzle-orm/sqlite-proxy";
import { migrate as migrateSqliteProxy } from "drizzle-orm/sqlite-proxy/migrator";
import postgres, { type Sql } from "postgres";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

import {
  approvalsTable as approvalsSqliteTable,
  authConnectionsTable as authConnectionsSqliteTable,
  authMaterialsTable as authMaterialsSqliteTable,
  oauthStatesTable as oauthStatesSqliteTable,
  organizationMembershipsTable as organizationMembershipsSqliteTable,
  organizationsTable as organizationsSqliteTable,
  policiesTable as policiesSqliteTable,
  profileTable as profileSqliteTable,
  sourceAuthBindingsTable as sourceAuthBindingsSqliteTable,
  sourcesTable as sourcesSqliteTable,
  storageInstancesTable as storageInstancesSqliteTable,
  syncStatesTable as syncStatesSqliteTable,
  tableNames,
  taskRunsTable as taskRunsSqliteTable,
  toolArtifactsTable as toolArtifactsSqliteTable,
  workspacesTable as workspacesSqliteTable,
} from "./schema";

type JsonCodec<A> = {
  encode: (value: A) => string;
  decode: (value: string) => A;
};

const makeJsonCodec = <A, I>(schema: Schema.Schema<A, I, never>): JsonCodec<A> => {
  const jsonSchema = Schema.parseJson(schema);

  return {
    encode: Schema.encodeSync(jsonSchema),
    decode: Schema.decodeUnknownSync(jsonSchema),
  };
};

const ProfileJson = makeJsonCodec(ProfileSchema);
const OrganizationJson = makeJsonCodec(OrganizationSchema);
const OrganizationMembershipJson = makeJsonCodec(OrganizationMembershipSchema);
const WorkspaceJson = makeJsonCodec(WorkspaceSchema);
const SourceJson = makeJsonCodec(SourceSchema);
const ToolArtifactJson = makeJsonCodec(ToolArtifactSchema);
const AuthConnectionJson = makeJsonCodec(AuthConnectionSchema);
const SourceAuthBindingJson = makeJsonCodec(SourceAuthBindingSchema);
const AuthMaterialJson = makeJsonCodec(AuthMaterialSchema);
const OAuthStateJson = makeJsonCodec(OAuthStateSchema);
const PolicyJson = makeJsonCodec(PolicySchema);
const ApprovalJson = makeJsonCodec(ApprovalSchema);
const TaskRunJson = makeJsonCodec(TaskRunSchema);
const StorageInstanceJson = makeJsonCodec(StorageInstanceSchema);
const SyncStateJson = makeJsonCodec(SyncStateSchema);

type SqlBackend = "sqlite" | "postgres";
type SqlRow = Record<string, unknown>;

type SqlAdapter = {
  readonly backend: SqlBackend;
  query: <TRow extends SqlRow = SqlRow>(
    statement: string,
    args?: ReadonlyArray<unknown>,
  ) => Promise<Array<TRow>>;
  execute: (statement: string, args?: ReadonlyArray<unknown>) => Promise<void>;
  transaction: <A>(run: (transaction: SqlAdapter) => Promise<A>) => Promise<A>;
  close: () => Promise<void>;
};

type SqliteStatement = {
  all: (...parameters: Array<unknown>) => Array<SqlRow>;
  run: (...parameters: Array<unknown>) => unknown;
};

type GenericSqliteDatabase = {
  exec: (statement: string) => void;
  prepare: (statement: string) => SqliteStatement;
  close: (...parameters: Array<unknown>) => void;
};

type NodeSqliteModule = {
  DatabaseSync: new (filename: string) => GenericSqliteDatabase;
};

type BunSqliteQuery = {
  all: (...parameters: Array<unknown>) => Array<SqlRow>;
  run: (...parameters: Array<unknown>) => unknown;
};

type BunSqliteDatabase = {
  query: (statement: string) => BunSqliteQuery;
  exec: (statement: string) => void;
  close: (...parameters: Array<unknown>) => void;
};

type BunSqliteModule = {
  Database: new (
    filename: string,
    options?: {
      create?: boolean;
      readonly?: boolean;
    },
  ) => BunSqliteDatabase;
};

export type SqlControlPlanePersistenceOptions = {
  databaseUrl?: string;
  sqlitePath?: string;
  postgresApplicationName?: string;
};

export type SqlControlPlanePersistence = {
  backend: SqlBackend;
  sourceStore: SourceStore;
  toolArtifactStore: ToolArtifactStore;
  rows: {
    profile: {
      get: () => Effect.Effect<Option.Option<Profile>, RowStoreError>;
      upsert: (profile: Profile) => Effect.Effect<void, RowStoreError>;
    };
    organizations: {
      list: () => Effect.Effect<ReadonlyArray<Organization>, RowStoreError>;
      upsert: (organization: Organization) => Effect.Effect<void, RowStoreError>;
    };
    organizationMemberships: {
      list: () => Effect.Effect<ReadonlyArray<OrganizationMembership>, RowStoreError>;
      upsert: (
        membership: OrganizationMembership,
      ) => Effect.Effect<void, RowStoreError>;
    };
    workspaces: {
      list: () => Effect.Effect<ReadonlyArray<Workspace>, RowStoreError>;
      upsert: (workspace: Workspace) => Effect.Effect<void, RowStoreError>;
    };
    authConnections: {
      list: () => Effect.Effect<ReadonlyArray<AuthConnection>, RowStoreError>;
      upsert: (connection: AuthConnection) => Effect.Effect<void, RowStoreError>;
      removeById: (
        connectionId: AuthConnection["id"],
      ) => Effect.Effect<boolean, RowStoreError>;
    };
    sourceAuthBindings: {
      list: () => Effect.Effect<ReadonlyArray<SourceAuthBinding>, RowStoreError>;
      upsert: (binding: SourceAuthBinding) => Effect.Effect<void, RowStoreError>;
      removeById: (
        bindingId: SourceAuthBinding["id"],
      ) => Effect.Effect<boolean, RowStoreError>;
    };
    authMaterials: {
      list: () => Effect.Effect<ReadonlyArray<AuthMaterial>, RowStoreError>;
      upsert: (material: AuthMaterial) => Effect.Effect<void, RowStoreError>;
      removeByConnectionId: (
        connectionId: AuthMaterial["connectionId"],
      ) => Effect.Effect<void, RowStoreError>;
    };
    oauthStates: {
      list: () => Effect.Effect<ReadonlyArray<OAuthState>, RowStoreError>;
      upsert: (state: OAuthState) => Effect.Effect<void, RowStoreError>;
      removeByConnectionId: (
        connectionId: OAuthState["connectionId"],
      ) => Effect.Effect<void, RowStoreError>;
    };
    storageInstances: {
      list: () => Effect.Effect<ReadonlyArray<StorageInstance>, RowStoreError>;
      upsert: (instance: StorageInstance) => Effect.Effect<void, RowStoreError>;
      removeById: (
        storageInstanceId: StorageInstance["id"],
      ) => Effect.Effect<boolean, RowStoreError>;
    };
    policies: {
      list: () => Effect.Effect<ReadonlyArray<Policy>, RowStoreError>;
      upsert: (policy: Policy) => Effect.Effect<void, RowStoreError>;
      removeById: (
        policyId: Policy["id"],
      ) => Effect.Effect<boolean, RowStoreError>;
    };
    approvals: {
      list: () => Effect.Effect<ReadonlyArray<Approval>, RowStoreError>;
      upsert: (approval: Approval) => Effect.Effect<void, RowStoreError>;
    };
  };
  close: () => Promise<void>;
};

class SqlPersistenceBootstrapError extends Data.TaggedError(
  "SqlPersistenceBootstrapError",
)<{
  message: string;
  details: string | null;
}> {}

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const toBackendLabel = (backend: SqlBackend): string => `sql-${backend}`;

const toErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toParseDetails = (cause: unknown): string | null =>
  ParseResult.isParseError(cause)
    ? ParseResult.TreeFormatter.formatErrorSync(cause)
    : null;

const toRowStoreError = (
  backend: SqlBackend,
  operation: string,
  location: string,
  cause: unknown,
): RowStoreError =>
  new RowStoreError({
    operation,
    backend: toBackendLabel(backend),
    location,
    message: toErrorMessage(cause),
    reason: null,
    details: toParseDetails(cause),
  });

const toSourceStoreError = (
  backend: SqlBackend,
  operation: string,
  location: string,
  cause: unknown,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    backend: toBackendLabel(backend),
    location,
    message: toErrorMessage(cause),
    reason: null,
    details: toParseDetails(cause),
  });

const toToolArtifactStoreError = (
  backend: SqlBackend,
  operation: string,
  location: string,
  cause: unknown,
): ToolArtifactStoreError =>
  new ToolArtifactStoreError({
    operation,
    backend: toBackendLabel(backend),
    location,
    message: toErrorMessage(cause),
    reason: null,
    details: toParseDetails(cause),
  });

const withPostgresPlaceholders = (statement: string): string => {
  let index = 0;
  return statement.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
};

const isBunRuntime = (): boolean =>
  typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

const loadNodeSqliteModule = async (): Promise<NodeSqliteModule> => {
  const dynamicImport = new Function(
    "return import('node:sqlite')",
  ) as () => Promise<unknown>;

  return (await dynamicImport()) as NodeSqliteModule;
};

const loadBunSqliteModule = async (): Promise<BunSqliteModule> => {
  const dynamicImport = new Function(
    "return import('bun:sqlite')",
  ) as () => Promise<unknown>;

  return (await dynamicImport()) as BunSqliteModule;
};

const makeSqliteTransaction = (
  execute: (statement: string, args?: ReadonlyArray<unknown>) => Promise<void>,
  query: <TRow extends SqlRow = SqlRow>(
    statement: string,
    args?: ReadonlyArray<unknown>,
  ) => Promise<Array<TRow>>,
): SqlAdapter["transaction"] =>
  async <A>(run: (transactionAdapter: SqlAdapter) => Promise<A>): Promise<A> => {
    await execute("BEGIN IMMEDIATE");

    try {
      const adapter: SqlAdapter = {
        backend: "sqlite",
        query,
        execute,
        transaction: async (nestedRun) => nestedRun(adapter),
        close: async () => {},
      };

      const result = await run(adapter);
      await execute("COMMIT");
      return result;
    } catch (error) {
      try {
        await execute("ROLLBACK");
      } catch {
        // ignore rollback failure after original error
      }

      throw error;
    }
  };

const createNodeSqliteAdapter = async (
  sqlitePath: string,
): Promise<SqlAdapter> => {
  const { DatabaseSync } = await loadNodeSqliteModule();
  const db = new DatabaseSync(sqlitePath);

  const query = async <TRow extends SqlRow = SqlRow>(
    statement: string,
    args: ReadonlyArray<unknown> = [],
  ): Promise<Array<TRow>> => {
    const prepared = db.prepare(statement);
    return prepared.all(...args) as Array<TRow>;
  };

  const execute = async (
    statement: string,
    args: ReadonlyArray<unknown> = [],
  ): Promise<void> => {
    if (args.length === 0) {
      db.exec(statement);
      return;
    }

    const prepared = db.prepare(statement);
    prepared.run(...args);
  };

  return {
    backend: "sqlite",
    query,
    execute,
    transaction: makeSqliteTransaction(execute, query),
    close: async () => {
      db.close();
    },
  };
};

const createBunSqliteAdapter = async (
  sqlitePath: string,
): Promise<SqlAdapter> => {
  const { Database } = await loadBunSqliteModule();
  const db = new Database(sqlitePath, { create: true });

  const query = async <TRow extends SqlRow = SqlRow>(
    statement: string,
    args: ReadonlyArray<unknown> = [],
  ): Promise<Array<TRow>> => db.query(statement).all(...args) as Array<TRow>;

  const execute = async (
    statement: string,
    args: ReadonlyArray<unknown> = [],
  ): Promise<void> => {
    db.query(statement).run(...args);
  };

  return {
    backend: "sqlite",
    query,
    execute,
    transaction: makeSqliteTransaction(execute, query),
    close: async () => {
      db.close();
    },
  };
};

const createSqliteAdapter = async (sqlitePath: string): Promise<SqlAdapter> => {
  const resolvedPath = path.resolve(sqlitePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });

  return isBunRuntime()
    ? createBunSqliteAdapter(resolvedPath)
    : createNodeSqliteAdapter(resolvedPath);
};

const createPostgresAdapter = async (
  databaseUrl: string,
  applicationName: string | undefined,
): Promise<SqlAdapter> => {
  const client = postgres(databaseUrl, {
    prepare: false,
    max: 10,
    ...(applicationName ? { connection: { application_name: applicationName } } : {}),
  });

  type UnsafeRunner = {
    unsafe: Sql["unsafe"];
  };

  const toPostgresParams = (
    args: ReadonlyArray<unknown>,
  ): Array<postgres.ParameterOrJSON<never>> =>
    args as unknown as Array<postgres.ParameterOrJSON<never>>;

  const queryWith = async <TRow extends SqlRow = SqlRow>(
    runner: UnsafeRunner,
    statement: string,
    args: ReadonlyArray<unknown> = [],
  ): Promise<Array<TRow>> =>
    (await runner.unsafe(
      withPostgresPlaceholders(statement),
      toPostgresParams(args),
    )) as unknown as Array<TRow>;

  const executeWith = async (
    runner: UnsafeRunner,
    statement: string,
    args: ReadonlyArray<unknown> = [],
  ): Promise<void> => {
    await runner.unsafe(
      withPostgresPlaceholders(statement),
      toPostgresParams(args),
    );
  };

  const adapter: SqlAdapter = {
    backend: "postgres",
    query: (statement, args = []) => queryWith(client, statement, args),
    execute: (statement, args = []) => executeWith(client, statement, args),
    transaction: async <A>(run: (transaction: SqlAdapter) => Promise<A>) => {
      const result = await client.begin(async (transactionClient) => {
        const runner: UnsafeRunner = transactionClient;
        const transactionAdapter: SqlAdapter = {
          backend: "postgres",
          query: (statement, args = []) => queryWith(runner, statement, args),
          execute: (statement, args = []) => executeWith(runner, statement, args),
          transaction: async (nestedRun) => nestedRun(transactionAdapter),
          close: async () => {},
        };

        return run(transactionAdapter);
      });

      return result as unknown as A;
    },
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };

  return adapter;
};

const resolveDrizzleMigrationsFolder = (): string => {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "packages/persistence-sql/drizzle"),
    path.resolve(cwd, "../packages/persistence-sql/drizzle"),
    path.resolve(cwd, "../../packages/persistence-sql/drizzle"),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve drizzle migrations folder");
};

const runMigrationQueries = async (
  adapter: SqlAdapter,
  queries: ReadonlyArray<string>,
): Promise<void> => {
  for (const query of queries) {
    const statement = query.trim();
    if (statement.length === 0) {
      continue;
    }

    await adapter.execute(statement);
  }
};

const toProxyRow = (row: unknown): unknown => {
  if (Array.isArray(row) || row === null || row === undefined) {
    return row;
  }

  if (typeof row === "object") {
    return Object.values(row as Record<string, unknown>);
  }

  return row;
};

const normalizeProxyRows = (
  method: "run" | "all" | "values" | "get",
  rows: ReadonlyArray<unknown>,
): Array<unknown> => {
  if (method === "get") {
    const first = rows[0];
    return first === undefined ? [] : [toProxyRow(first)];
  }

  return rows.map(toProxyRow);
};

const sqliteDrizzleSchema = {
  profileTable: profileSqliteTable,
  organizationsTable: organizationsSqliteTable,
  organizationMembershipsTable: organizationMembershipsSqliteTable,
  workspacesTable: workspacesSqliteTable,
  sourcesTable: sourcesSqliteTable,
  toolArtifactsTable: toolArtifactsSqliteTable,
  authConnectionsTable: authConnectionsSqliteTable,
  sourceAuthBindingsTable: sourceAuthBindingsSqliteTable,
  authMaterialsTable: authMaterialsSqliteTable,
  oauthStatesTable: oauthStatesSqliteTable,
  policiesTable: policiesSqliteTable,
  approvalsTable: approvalsSqliteTable,
  taskRunsTable: taskRunsSqliteTable,
  storageInstancesTable: storageInstancesSqliteTable,
  syncStatesTable: syncStatesSqliteTable,
};

type SqliteDrizzleSchema = typeof sqliteDrizzleSchema;
type DrizzleDb = ReturnType<typeof drizzleSqliteProxy<SqliteDrizzleSchema>>;
type DrizzleTables = SqliteDrizzleSchema;

type DrizzleContext = {
  db: DrizzleDb;
  tables: DrizzleTables;
};

const createSqliteProxyDb = (adapter: SqlAdapter): DrizzleDb =>
  drizzleSqliteProxy(
    async (statement, params, method) => {
      if (method === "run") {
        await adapter.execute(statement, params);
        return { rows: [] };
      }

      const rows = await adapter.query(statement, params);
      return {
        rows: normalizeProxyRows(method, rows),
      };
    },
    {
      schema: sqliteDrizzleSchema,
    },
  );

const createDrizzleContext = (adapter: SqlAdapter): DrizzleContext => ({
  db: createSqliteProxyDb(adapter),
  tables: sqliteDrizzleSchema,
});

const createPostgresMigrationDb = (adapter: SqlAdapter) =>
  drizzlePgProxy(async (statement, params, method) => {
    if (method === "execute") {
      await adapter.execute(statement, params);
      return { rows: [] };
    }

    const rows = await adapter.query(statement, params);
    return { rows };
  });

const runMigrations = async (
  backend: SqlBackend,
  adapter: SqlAdapter,
): Promise<void> => {
  const migrationsFolder = resolveDrizzleMigrationsFolder();

  if (backend === "postgres") {
    const migrationDb = createPostgresMigrationDb(adapter);
    await migratePgProxy(
      migrationDb,
      async (queries) => runMigrationQueries(adapter, queries),
      {
        migrationsFolder,
      },
    );
    return;
  }

  const migrationDb = createSqliteProxyDb(adapter);
  await migrateSqliteProxy(
    migrationDb,
    async (queries) => runMigrationQueries(adapter, queries),
    {
      migrationsFolder,
    },
  );
};

const sourceStoreKey = (source: Source): string => `${source.workspaceId}:${source.id}`;

const sortSources = (sources: ReadonlyArray<Source>): Array<Source> =>
  [...sources].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName === rightName) {
      return sourceStoreKey(left).localeCompare(sourceStoreKey(right));
    }

    return leftName.localeCompare(rightName);
  });

const withWriteLock = <A>(
  queueRef: { current: Promise<void> },
  run: () => Promise<A>,
): Promise<A> => {
  const next = queueRef.current.then(run, run);
  queueRef.current = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

export const makeSqlControlPlanePersistence = (
  options: SqlControlPlanePersistenceOptions,
): Effect.Effect<SqlControlPlanePersistence, SqlPersistenceBootstrapError> =>
  Effect.tryPromise({
    try: async () => {
      const databaseUrl = trim(options.databaseUrl);
      const sqlitePath = path.resolve(
        options.sqlitePath ?? ".executor-v2/control-plane.sqlite",
      );
      const backend: SqlBackend =
        databaseUrl && (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))
          ? "postgres"
          : "sqlite";

      const adapter =
        backend === "postgres"
          ? await createPostgresAdapter(databaseUrl!, trim(options.postgresApplicationName))
          : await createSqliteAdapter(sqlitePath);

      await runMigrations(backend, adapter);
      const drizzleContext = createDrizzleContext(adapter);
      const { db, tables } = drizzleContext;

      const writeQueueRef = {
        current: Promise.resolve<void>(undefined),
      };

      const listOrganizationsRows = async (): Promise<Array<Organization>> => {
        const rows = await db
          .select({ payloadJson: tables.organizationsTable.payloadJson })
          .from(tables.organizationsTable)
          .orderBy(
            asc(tables.organizationsTable.updatedAt),
            asc(tables.organizationsTable.id),
          );

        return rows.map((row) => OrganizationJson.decode(row.payloadJson));
      };

      const upsertOrganizationRow = async (
        organization: Organization,
      ): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = OrganizationJson.encode(organization);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.organizationsTable)
              .values({
                id: organization.id,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.organizationsTable.id,
                set: {
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const listOrganizationMembershipRows = async (): Promise<
        Array<OrganizationMembership>
      > => {
        const rows = await db
          .select({ payloadJson: tables.organizationMembershipsTable.payloadJson })
          .from(tables.organizationMembershipsTable)
          .orderBy(
            asc(tables.organizationMembershipsTable.updatedAt),
            asc(tables.organizationMembershipsTable.id),
          );

        return rows.map((row) => OrganizationMembershipJson.decode(row.payloadJson));
      };

      const upsertOrganizationMembershipRow = async (
        membership: OrganizationMembership,
      ): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = OrganizationMembershipJson.encode(membership);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.organizationMembershipsTable)
              .values({
                id: membership.id,
                workspaceId: null,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.organizationMembershipsTable.id,
                set: {
                  workspaceId: null,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const listWorkspaceRows = async (): Promise<Array<Workspace>> => {
        const rows = await db
          .select({ payloadJson: tables.workspacesTable.payloadJson })
          .from(tables.workspacesTable)
          .orderBy(
            asc(tables.workspacesTable.updatedAt),
            asc(tables.workspacesTable.id),
          );

        return rows.map((row) => WorkspaceJson.decode(row.payloadJson));
      };

      const upsertWorkspaceRow = async (workspace: Workspace): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = WorkspaceJson.encode(workspace);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.workspacesTable)
              .values({
                id: workspace.id,
                workspaceId: workspace.organizationId,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.workspacesTable.id,
                set: {
                  workspaceId: workspace.organizationId,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const listAuthConnectionRows = async (): Promise<Array<AuthConnection>> => {
        const rows = await db
          .select({ payloadJson: tables.authConnectionsTable.payloadJson })
          .from(tables.authConnectionsTable)
          .orderBy(asc(tables.authConnectionsTable.updatedAt), asc(tables.authConnectionsTable.id));

        return rows.map((row) => AuthConnectionJson.decode(row.payloadJson));
      };

      const upsertAuthConnectionRow = async (connection: AuthConnection): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = AuthConnectionJson.encode(connection);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.authConnectionsTable)
              .values({
                id: connection.id,
                workspaceId: connection.workspaceId,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.authConnectionsTable.id,
                set: {
                  workspaceId: connection.workspaceId,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const removeAuthConnectionRowById = async (
        connectionId: AuthConnection["id"],
      ): Promise<boolean> =>
        withWriteLock(writeQueueRef, async () =>
          adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const existing = await transactionContext.db
              .select({ id: transactionContext.tables.authConnectionsTable.id })
              .from(transactionContext.tables.authConnectionsTable)
              .where(eq(transactionContext.tables.authConnectionsTable.id, connectionId))
              .limit(1);

            if (existing.length === 0) {
              return false;
            }

            await transactionContext.db
              .delete(transactionContext.tables.authConnectionsTable)
              .where(eq(transactionContext.tables.authConnectionsTable.id, connectionId));

            return true;
          })
        );

      const listSourceAuthBindingRows = async (): Promise<Array<SourceAuthBinding>> => {
        const rows = await db
          .select({ payloadJson: tables.sourceAuthBindingsTable.payloadJson })
          .from(tables.sourceAuthBindingsTable)
          .orderBy(
            asc(tables.sourceAuthBindingsTable.updatedAt),
            asc(tables.sourceAuthBindingsTable.id),
          );

        return rows.map((row) => SourceAuthBindingJson.decode(row.payloadJson));
      };

      const upsertSourceAuthBindingRow = async (
        binding: SourceAuthBinding,
      ): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = SourceAuthBindingJson.encode(binding);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.sourceAuthBindingsTable)
              .values({
                id: binding.id,
                workspaceId: binding.workspaceId,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.sourceAuthBindingsTable.id,
                set: {
                  workspaceId: binding.workspaceId,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const removeSourceAuthBindingRowById = async (
        bindingId: SourceAuthBinding["id"],
      ): Promise<boolean> =>
        withWriteLock(writeQueueRef, async () =>
          adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const existing = await transactionContext.db
              .select({ id: transactionContext.tables.sourceAuthBindingsTable.id })
              .from(transactionContext.tables.sourceAuthBindingsTable)
              .where(eq(transactionContext.tables.sourceAuthBindingsTable.id, bindingId))
              .limit(1);

            if (existing.length === 0) {
              return false;
            }

            await transactionContext.db
              .delete(transactionContext.tables.sourceAuthBindingsTable)
              .where(eq(transactionContext.tables.sourceAuthBindingsTable.id, bindingId));

            return true;
          })
        );

      const listAuthMaterialRows = async (): Promise<Array<AuthMaterial>> => {
        const rows = await db
          .select({ payloadJson: tables.authMaterialsTable.payloadJson })
          .from(tables.authMaterialsTable)
          .orderBy(asc(tables.authMaterialsTable.updatedAt), asc(tables.authMaterialsTable.id));

        return rows.map((row) => AuthMaterialJson.decode(row.payloadJson));
      };

      const upsertAuthMaterialRow = async (material: AuthMaterial): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = AuthMaterialJson.encode(material);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.authMaterialsTable)
              .values({
                id: material.id,
                workspaceId: null,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.authMaterialsTable.id,
                set: {
                  workspaceId: null,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const removeAuthMaterialRowsByConnectionId = async (
        connectionId: AuthMaterial["connectionId"],
      ): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const existing = await transactionContext.db
              .select({
                id: transactionContext.tables.authMaterialsTable.id,
                payloadJson: transactionContext.tables.authMaterialsTable.payloadJson,
              })
              .from(transactionContext.tables.authMaterialsTable);

            for (const row of existing) {
              const material = AuthMaterialJson.decode(row.payloadJson);
              if (material.connectionId !== connectionId) {
                continue;
              }

              await transactionContext.db
                .delete(transactionContext.tables.authMaterialsTable)
                .where(eq(transactionContext.tables.authMaterialsTable.id, row.id));
            }
          });
        });
      };

      const listOAuthStateRows = async (): Promise<Array<OAuthState>> => {
        const rows = await db
          .select({ payloadJson: tables.oauthStatesTable.payloadJson })
          .from(tables.oauthStatesTable)
          .orderBy(asc(tables.oauthStatesTable.updatedAt), asc(tables.oauthStatesTable.id));

        return rows.map((row) => OAuthStateJson.decode(row.payloadJson));
      };

      const upsertOAuthStateRow = async (state: OAuthState): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = OAuthStateJson.encode(state);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.oauthStatesTable)
              .values({
                id: state.id,
                workspaceId: null,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.oauthStatesTable.id,
                set: {
                  workspaceId: null,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const removeOAuthStateRowsByConnectionId = async (
        connectionId: OAuthState["connectionId"],
      ): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const existing = await transactionContext.db
              .select({
                id: transactionContext.tables.oauthStatesTable.id,
                payloadJson: transactionContext.tables.oauthStatesTable.payloadJson,
              })
              .from(transactionContext.tables.oauthStatesTable);

            for (const row of existing) {
              const state = OAuthStateJson.decode(row.payloadJson);
              if (state.connectionId !== connectionId) {
                continue;
              }

              await transactionContext.db
                .delete(transactionContext.tables.oauthStatesTable)
                .where(eq(transactionContext.tables.oauthStatesTable.id, row.id));
            }
          });
        });
      };

      const listStorageInstanceRows = async (): Promise<Array<StorageInstance>> => {
        const rows = await db
          .select({ payloadJson: tables.storageInstancesTable.payloadJson })
          .from(tables.storageInstancesTable)
          .orderBy(
            asc(tables.storageInstancesTable.updatedAt),
            asc(tables.storageInstancesTable.id),
          );

        return rows.map((row) => StorageInstanceJson.decode(row.payloadJson));
      };

      const upsertStorageInstanceRow = async (
        storageInstance: StorageInstance,
      ): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = StorageInstanceJson.encode(storageInstance);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.storageInstancesTable)
              .values({
                id: storageInstance.id,
                workspaceId: storageInstance.workspaceId,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.storageInstancesTable.id,
                set: {
                  workspaceId: storageInstance.workspaceId,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const removeStorageInstanceRowById = async (
        storageInstanceId: StorageInstance["id"],
      ): Promise<boolean> =>
        withWriteLock(writeQueueRef, async () =>
          adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const existing = await transactionContext.db
              .select({ id: transactionContext.tables.storageInstancesTable.id })
              .from(transactionContext.tables.storageInstancesTable)
              .where(eq(transactionContext.tables.storageInstancesTable.id, storageInstanceId))
              .limit(1);

            if (existing.length === 0) {
              return false;
            }

            await transactionContext.db
              .delete(transactionContext.tables.storageInstancesTable)
              .where(eq(transactionContext.tables.storageInstancesTable.id, storageInstanceId));

            return true;
          })
        );

      const listPolicyRows = async (): Promise<Array<Policy>> => {
        const rows = await db
          .select({ payloadJson: tables.policiesTable.payloadJson })
          .from(tables.policiesTable)
          .orderBy(asc(tables.policiesTable.updatedAt), asc(tables.policiesTable.id));

        return rows.map((row) => PolicyJson.decode(row.payloadJson));
      };

      const upsertPolicyRow = async (policy: Policy): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = PolicyJson.encode(policy);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.policiesTable)
              .values({
                id: policy.id,
                workspaceId: policy.workspaceId,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.policiesTable.id,
                set: {
                  workspaceId: policy.workspaceId,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const removePolicyRowById = async (policyId: Policy["id"]): Promise<boolean> => {
        return withWriteLock(writeQueueRef, async () =>
          adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);

            const existing = await transactionContext.db
              .select({ id: transactionContext.tables.policiesTable.id })
              .from(transactionContext.tables.policiesTable)
              .where(eq(transactionContext.tables.policiesTable.id, policyId))
              .limit(1);

            if (existing.length === 0) {
              return false;
            }

            await transactionContext.db
              .delete(transactionContext.tables.policiesTable)
              .where(eq(transactionContext.tables.policiesTable.id, policyId));

            return true;
          })
        );
      };

      const listApprovalRows = async (): Promise<Array<Approval>> => {
        const rows = await db
          .select({ payloadJson: tables.approvalsTable.payloadJson })
          .from(tables.approvalsTable)
          .orderBy(asc(tables.approvalsTable.updatedAt), asc(tables.approvalsTable.id));

        return rows.map((row) => ApprovalJson.decode(row.payloadJson));
      };

      const upsertApprovalRow = async (approval: Approval): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const payloadJson = ApprovalJson.encode(approval);
            const now = Date.now();

            await transactionContext.db
              .insert(transactionContext.tables.approvalsTable)
              .values({
                id: approval.id,
                workspaceId: approval.workspaceId,
                payloadJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.approvalsTable.id,
                set: {
                  workspaceId: approval.workspaceId,
                  payloadJson,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const getProfileRow = async (): Promise<Profile | null> => {
        const rows = await db
          .select({ profileJson: tables.profileTable.profileJson })
          .from(tables.profileTable)
          .where(eq(tables.profileTable.id, 1))
          .limit(1);

        const row = rows[0];
        if (!row) {
          return null;
        }

        return ProfileJson.decode(row.profileJson);
      };

      const upsertProfileRow = async (profile: Profile): Promise<void> => {
        await withWriteLock(writeQueueRef, async () => {
          await adapter.transaction(async (transaction) => {
            const transactionContext = createDrizzleContext(transaction);
            const currentRows = await transactionContext.db
              .select({ schemaVersion: transactionContext.tables.profileTable.schemaVersion })
              .from(transactionContext.tables.profileTable)
              .where(eq(transactionContext.tables.profileTable.id, 1))
              .limit(1);

            const schemaVersion = currentRows[0]?.schemaVersion ?? 1;
            const now = Date.now();
            const profileJson = ProfileJson.encode(profile);

            await transactionContext.db
              .insert(transactionContext.tables.profileTable)
              .values({
                id: 1,
                schemaVersion,
                generatedAt: now,
                profileJson,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: transactionContext.tables.profileTable.id,
                set: {
                  profileJson,
                  generatedAt: now,
                  updatedAt: now,
                },
              });
          });
        });
      };

      const sourceStore: SourceStore = {
        getById: (workspaceId: WorkspaceId, sourceId: SourceId) =>
          Effect.tryPromise({
            try: async () => {
              const rows = await db
                .select({ payloadJson: tables.sourcesTable.payloadJson })
                .from(tables.sourcesTable)
                .where(
                  and(
                    eq(tables.sourcesTable.workspaceId, workspaceId),
                    eq(tables.sourcesTable.sourceId, sourceId),
                  ),
                )
                .limit(1);

              const row = rows[0];
              if (!row) {
                return Option.none<Source>();
              }

              return Option.some(SourceJson.decode(row.payloadJson));
            },
            catch: (cause) =>
              toSourceStoreError(backend, "get_by_id", tableNames.sources, cause),
          }),

        listByWorkspace: (workspaceId: WorkspaceId) =>
          Effect.tryPromise({
            try: async () => {
              const rows = await db
                .select({ payloadJson: tables.sourcesTable.payloadJson })
                .from(tables.sourcesTable)
                .where(eq(tables.sourcesTable.workspaceId, workspaceId))
                .orderBy(asc(tables.sourcesTable.name), asc(tables.sourcesTable.sourceId));

              return sortSources(rows.map((row) => SourceJson.decode(row.payloadJson)));
            },
            catch: (cause) =>
              toSourceStoreError(backend, "list_by_workspace", tableNames.sources, cause),
          }),

        upsert: (source: Source) =>
          Effect.tryPromise({
            try: async () => {
              await withWriteLock(writeQueueRef, async () => {
                await adapter.transaction(async (transaction) => {
                  const transactionContext = createDrizzleContext(transaction);
                  const payloadJson = SourceJson.encode(source);
                  const updatedAt = Date.now();

                  await transactionContext.db
                    .insert(transactionContext.tables.sourcesTable)
                    .values({
                      workspaceId: source.workspaceId,
                      sourceId: source.id,
                      name: source.name,
                      payloadJson,
                      updatedAt,
                    })
                    .onConflictDoUpdate({
                      target: [
                        transactionContext.tables.sourcesTable.workspaceId,
                        transactionContext.tables.sourcesTable.sourceId,
                      ],
                      set: {
                        name: source.name,
                        payloadJson,
                        updatedAt,
                      },
                    });
                });
              });
            },
            catch: (cause) =>
              toSourceStoreError(backend, "upsert", tableNames.sources, cause),
          }),

        removeById: (workspaceId: WorkspaceId, sourceId: SourceId) =>
          Effect.tryPromise({
            try: async () =>
              withWriteLock(writeQueueRef, async () =>
                adapter.transaction(async (transaction) => {
                  const transactionContext = createDrizzleContext(transaction);
                  const existing = await transactionContext.db
                    .select({ sourceId: transactionContext.tables.sourcesTable.sourceId })
                    .from(transactionContext.tables.sourcesTable)
                    .where(
                      and(
                        eq(transactionContext.tables.sourcesTable.workspaceId, workspaceId),
                        eq(transactionContext.tables.sourcesTable.sourceId, sourceId),
                      ),
                    )
                    .limit(1);

                  if (existing.length === 0) {
                    return false;
                  }

                  await transactionContext.db
                    .delete(transactionContext.tables.sourcesTable)
                    .where(
                      and(
                        eq(transactionContext.tables.sourcesTable.workspaceId, workspaceId),
                        eq(transactionContext.tables.sourcesTable.sourceId, sourceId),
                      ),
                    );

                  return true;
                })
              ),
            catch: (cause) =>
              toSourceStoreError(backend, "remove_by_id", tableNames.sources, cause),
          }),
      };

      const toolArtifactStore: ToolArtifactStore = {
        getBySource: (workspaceId: WorkspaceId, sourceId: SourceId) =>
          Effect.tryPromise({
            try: async () => {
              const rows = await db
                .select({ payloadJson: tables.toolArtifactsTable.payloadJson })
                .from(tables.toolArtifactsTable)
                .where(
                  and(
                    eq(tables.toolArtifactsTable.workspaceId, workspaceId),
                    eq(tables.toolArtifactsTable.sourceId, sourceId),
                  ),
                )
                .limit(1);

              const row = rows[0];
              if (!row) {
                return Option.none<ToolArtifact>();
              }

              return Option.some(ToolArtifactJson.decode(row.payloadJson));
            },
            catch: (cause) =>
              toToolArtifactStoreError(
                backend,
                "get_by_source",
                tableNames.toolArtifacts,
                cause,
              ),
          }),

        upsert: (artifact: ToolArtifact) =>
          Effect.tryPromise({
            try: async () => {
              await withWriteLock(writeQueueRef, async () => {
                await adapter.transaction(async (transaction) => {
                  const transactionContext = createDrizzleContext(transaction);
                  const payloadJson = ToolArtifactJson.encode(artifact);
                  const updatedAt = Date.now();

                  await transactionContext.db
                    .insert(transactionContext.tables.toolArtifactsTable)
                    .values({
                      workspaceId: artifact.workspaceId,
                      sourceId: artifact.sourceId,
                      payloadJson,
                      updatedAt,
                    })
                    .onConflictDoUpdate({
                      target: [
                        transactionContext.tables.toolArtifactsTable.workspaceId,
                        transactionContext.tables.toolArtifactsTable.sourceId,
                      ],
                      set: {
                        payloadJson,
                        updatedAt,
                      },
                    });
                });
              });
            },
            catch: (cause) =>
              toToolArtifactStoreError(backend, "upsert", tableNames.toolArtifacts, cause),
          }),
      };

      const rows: SqlControlPlanePersistence["rows"] = {
        profile: {
          get: () =>
            Effect.tryPromise({
              try: async () => {
                const profile = await getProfileRow();
                return profile === null
                  ? Option.none<Profile>()
                  : Option.some(profile);
              },
              catch: (cause) =>
                toRowStoreError(backend, "rows.profile.get", tableNames.profile, cause),
            }),
          upsert: (profile) =>
            Effect.tryPromise({
              try: () => upsertProfileRow(profile),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.profile.upsert",
                  tableNames.profile,
                  cause,
                ),
            }),
        },
        organizations: {
          list: () =>
            Effect.tryPromise({
              try: () => listOrganizationsRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.organizations.list",
                  tableNames.organizations,
                  cause,
                ),
            }),
          upsert: (organization) =>
            Effect.tryPromise({
              try: () => upsertOrganizationRow(organization),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.organizations.upsert",
                  tableNames.organizations,
                  cause,
                ),
            }),
        },
        organizationMemberships: {
          list: () =>
            Effect.tryPromise({
              try: () => listOrganizationMembershipRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.organizationMemberships.list",
                  tableNames.organizationMemberships,
                  cause,
                ),
            }),
          upsert: (membership) =>
            Effect.tryPromise({
              try: () => upsertOrganizationMembershipRow(membership),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.organizationMemberships.upsert",
                  tableNames.organizationMemberships,
                  cause,
                ),
            }),
        },
        workspaces: {
          list: () =>
            Effect.tryPromise({
              try: () => listWorkspaceRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.workspaces.list",
                  tableNames.workspaces,
                  cause,
                ),
            }),
          upsert: (workspace) =>
            Effect.tryPromise({
              try: () => upsertWorkspaceRow(workspace),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.workspaces.upsert",
                  tableNames.workspaces,
                  cause,
                ),
            }),
        },
        authConnections: {
          list: () =>
            Effect.tryPromise({
              try: () => listAuthConnectionRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.authConnections.list",
                  tableNames.authConnections,
                  cause,
                ),
            }),
          upsert: (connection) =>
            Effect.tryPromise({
              try: () => upsertAuthConnectionRow(connection),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.authConnections.upsert",
                  tableNames.authConnections,
                  cause,
                ),
            }),
          removeById: (connectionId) =>
            Effect.tryPromise({
              try: () => removeAuthConnectionRowById(connectionId),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.authConnections.remove",
                  tableNames.authConnections,
                  cause,
                ),
            }),
        },
        sourceAuthBindings: {
          list: () =>
            Effect.tryPromise({
              try: () => listSourceAuthBindingRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.sourceAuthBindings.list",
                  tableNames.sourceAuthBindings,
                  cause,
                ),
            }),
          upsert: (binding) =>
            Effect.tryPromise({
              try: () => upsertSourceAuthBindingRow(binding),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.sourceAuthBindings.upsert",
                  tableNames.sourceAuthBindings,
                  cause,
                ),
            }),
          removeById: (bindingId) =>
            Effect.tryPromise({
              try: () => removeSourceAuthBindingRowById(bindingId),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.sourceAuthBindings.remove",
                  tableNames.sourceAuthBindings,
                  cause,
                ),
            }),
        },
        authMaterials: {
          list: () =>
            Effect.tryPromise({
              try: () => listAuthMaterialRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.authMaterials.list",
                  tableNames.authMaterials,
                  cause,
                ),
            }),
          upsert: (material) =>
            Effect.tryPromise({
              try: () => upsertAuthMaterialRow(material),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.authMaterials.upsert",
                  tableNames.authMaterials,
                  cause,
                ),
            }),
          removeByConnectionId: (connectionId) =>
            Effect.tryPromise({
              try: () => removeAuthMaterialRowsByConnectionId(connectionId),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.authMaterials.remove_by_connection",
                  tableNames.authMaterials,
                  cause,
                ),
            }),
        },
        oauthStates: {
          list: () =>
            Effect.tryPromise({
              try: () => listOAuthStateRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.oauthStates.list",
                  tableNames.oauthStates,
                  cause,
                ),
            }),
          upsert: (state) =>
            Effect.tryPromise({
              try: () => upsertOAuthStateRow(state),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.oauthStates.upsert",
                  tableNames.oauthStates,
                  cause,
                ),
            }),
          removeByConnectionId: (connectionId) =>
            Effect.tryPromise({
              try: () => removeOAuthStateRowsByConnectionId(connectionId),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.oauthStates.remove_by_connection",
                  tableNames.oauthStates,
                  cause,
                ),
            }),
        },
        storageInstances: {
          list: () =>
            Effect.tryPromise({
              try: () => listStorageInstanceRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.storageInstances.list",
                  tableNames.storageInstances,
                  cause,
                ),
            }),
          upsert: (storageInstance) =>
            Effect.tryPromise({
              try: () => upsertStorageInstanceRow(storageInstance),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.storageInstances.upsert",
                  tableNames.storageInstances,
                  cause,
                ),
            }),
          removeById: (storageInstanceId) =>
            Effect.tryPromise({
              try: () => removeStorageInstanceRowById(storageInstanceId),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.storageInstances.remove",
                  tableNames.storageInstances,
                  cause,
                ),
            }),
        },
        policies: {
          list: () =>
            Effect.tryPromise({
              try: () => listPolicyRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.policies.list",
                  tableNames.policies,
                  cause,
                ),
            }),
          upsert: (policy) =>
            Effect.tryPromise({
              try: () => upsertPolicyRow(policy),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.policies.upsert",
                  tableNames.policies,
                  cause,
                ),
            }),
          removeById: (policyId) =>
            Effect.tryPromise({
              try: () => removePolicyRowById(policyId),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.policies.remove",
                  tableNames.policies,
                  cause,
                ),
            }),
        },
        approvals: {
          list: () =>
            Effect.tryPromise({
              try: () => listApprovalRows(),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.approvals.list",
                  tableNames.approvals,
                  cause,
                ),
            }),
          upsert: (approval) =>
            Effect.tryPromise({
              try: () => upsertApprovalRow(approval),
              catch: (cause) =>
                toRowStoreError(
                  backend,
                  "rows.approvals.upsert",
                  tableNames.approvals,
                  cause,
                ),
            }),
        },
      };

      return {
        backend,
        sourceStore,
        toolArtifactStore,
        rows,
        close: () => adapter.close(),
      };
    },
    catch: (cause) => {
      const details = cause instanceof Error ? cause.message : String(cause);
      return new SqlPersistenceBootstrapError({
        message: `Failed initializing SQL control-plane persistence: ${details}`,
        details,
      });
    },
  });
