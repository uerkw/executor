import {
  makeControlPlaneStorageService,
  type ControlPlaneStorageServiceShape,
} from "@executor-v2/management-api";
import { SourceStoreError } from "@executor-v2/persistence-ports";
import { type SqlControlPlanePersistence } from "@executor-v2/persistence-sql";
import {
  type OrganizationId,
  type StorageInstance,
  type Workspace,
  type WorkspaceId,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";

type StorageRows = Pick<
  SqlControlPlanePersistence["rows"],
  "workspaces" | "storageInstances"
>;

const DEFAULT_EPHEMERAL_TTL_HOURS = 24;
const DEFAULT_KV_LIMIT = 100;
const MAX_KV_LIMIT = 1000;
const DEFAULT_SQL_MAX_ROWS = 200;
const MAX_SQL_MAX_ROWS = 5000;
const MILLIS_PER_HOUR = 3_600_000;
const STORAGE_ROOT_DIRECTORY = "storage";
const STORAGE_FS_DIRECTORY = "fs";
const STORAGE_KV_FILE = "kv-store.json";
const STORAGE_SQLITE_FILE = "storage.sqlite";

type SqliteDatabaseInstance = {
  exec: (sql: string) => void;
  query: (sql: string) => {
    all: () => Array<Record<string, unknown>>;
  };
  run: (sql: string) => unknown;
  close: () => void;
};

type SqliteDatabaseConstructor = new (
  filename: string,
  options?: {
    create?: boolean;
  },
) => SqliteDatabaseInstance;

const loadSqliteDatabase = async (): Promise<SqliteDatabaseConstructor | null> => {
  try {
    const sqliteModule = await import("bun:sqlite");
    return sqliteModule.Database as SqliteDatabaseConstructor;
  } catch {
    return null;
  }
};

const toSourceStoreError = (
  operation: string,
  message: string,
  details: string | null,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    backend: "sql",
    location: "storage",
    message,
    reason: null,
    details,
  });

const toSourceStoreErrorFromRowStore = (
  operation: string,
  error: { message: string; details: string | null; reason: string | null },
): SourceStoreError =>
  toSourceStoreError(operation, error.message, error.details ?? error.reason ?? null);

const toSourceStoreErrorFromCause = (
  operation: string,
  cause: unknown,
  details?: string,
): SourceStoreError =>
  toSourceStoreError(
    operation,
    cause instanceof Error ? cause.message : String(cause),
    details ?? null,
  );

const resolveWorkspaceOrganizationId = (
  workspaces: ReadonlyArray<Workspace>,
  workspaceId: WorkspaceId,
): OrganizationId => {
  const workspace = workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  return workspace.organizationId;
};

const canAccessStorageInstance = (
  instance: StorageInstance,
  workspaceId: WorkspaceId,
  organizationId: OrganizationId,
): boolean =>
  instance.workspaceId === workspaceId
  || (instance.workspaceId === null && instance.organizationId === organizationId);

const sortStorageInstances = (
  storageInstances: ReadonlyArray<StorageInstance>,
): Array<StorageInstance> =>
  [...storageInstances].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.id.localeCompare(right.id);
  });

const storageInstanceRootPath = (stateRootDir: string, storageInstanceId: string): string =>
  path.resolve(stateRootDir, STORAGE_ROOT_DIRECTORY, storageInstanceId);

const storageInstanceFsRootPath = (
  stateRootDir: string,
  storageInstanceId: string,
): string =>
  path.resolve(
    storageInstanceRootPath(stateRootDir, storageInstanceId),
    STORAGE_FS_DIRECTORY,
  );

const storageInstanceKvPath = (stateRootDir: string, storageInstanceId: string): string =>
  path.resolve(
    storageInstanceRootPath(stateRootDir, storageInstanceId),
    STORAGE_KV_FILE,
  );

const storageInstanceSqlitePath = (
  stateRootDir: string,
  storageInstanceId: string,
): string =>
  path.resolve(
    storageInstanceRootPath(stateRootDir, storageInstanceId),
    STORAGE_SQLITE_FILE,
  );

const initializeStorageInstanceFiles = async (
  stateRootDir: string,
  storageInstanceId: string,
): Promise<void> => {
  const rootPath = storageInstanceRootPath(stateRootDir, storageInstanceId);
  const fsRootPath = storageInstanceFsRootPath(stateRootDir, storageInstanceId);
  const kvPath = storageInstanceKvPath(stateRootDir, storageInstanceId);
  const sqlitePath = storageInstanceSqlitePath(stateRootDir, storageInstanceId);

  await mkdir(rootPath, { recursive: true });
  await mkdir(fsRootPath, { recursive: true });

  const kvJson = JSON.stringify({}, null, 2);
  await writeFile(kvPath, kvJson, { encoding: "utf8" });

  const SqliteDatabase = await loadSqliteDatabase();
  if (SqliteDatabase === null) {
    await writeFile(sqlitePath, "", { encoding: "utf8" });
    return;
  }

  const db = new SqliteDatabase(sqlitePath, { create: true });
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
  } finally {
    db.close();
  }
};

const resolvePathWithinRoot = (
  rootPath: string,
  requestedPath: string,
): {
  normalizedPath: string;
  absolutePath: string;
} => {
  const trimmed = requestedPath.trim();
  const normalizedPath = path.posix.normalize(
    trimmed.length > 0
      ? (trimmed.startsWith("/") ? trimmed : `/${trimmed}`)
      : "/",
  );

  const relativePath = normalizedPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(rootPath, relativePath);

  if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Path escapes storage root");
  }

  return {
    normalizedPath,
    absolutePath,
  };
};

const toStorageEntryPath = (absolutePath: string, fsRootPath: string): string => {
  const relativePath = path.relative(fsRootPath, absolutePath);
  return `/${relativePath.split(path.sep).join("/")}`;
};

const readKvStore = async (
  kvPath: string,
): Promise<Record<string, unknown>> => {
  const raw = await readFile(kvPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return {};
};

const findStorageInstance = (
  storageInstances: ReadonlyArray<StorageInstance>,
  organizationId: OrganizationId,
  input: {
    workspaceId: WorkspaceId;
    storageInstanceId: StorageInstance["id"];
  },
): {
  storageInstance: StorageInstance;
} | null => {
  const storageInstance = storageInstances.find((instance) =>
    instance.id === input.storageInstanceId
    && canAccessStorageInstance(instance, input.workspaceId, organizationId)
  );

  if (!storageInstance) {
    return null;
  }

  return {
    storageInstance,
  };
};

const touchStorageInstance = (
  rows: StorageRows,
  existing: StorageInstance,
  operation: string,
): Effect.Effect<StorageInstance, SourceStoreError> => {
  const now = Date.now();
  const next: StorageInstance = {
    ...existing,
    updatedAt: now,
    lastSeenAt: now,
  };

  return rows.storageInstances.upsert(next).pipe(
    Effect.mapError((error) => toSourceStoreErrorFromRowStore(operation, error)),
    Effect.as(next),
  );
};

export const createPmStorageService = (
  rows: StorageRows,
  options: {
    stateRootDir: string;
  },
): ControlPlaneStorageServiceShape =>
  makeControlPlaneStorageService({
    listStorageInstances: (workspaceId) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.list_instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.list_instances.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, workspaceId);

        return sortStorageInstances(
          storageInstances.filter((instance) =>
            canAccessStorageInstance(instance, workspaceId, organizationId)
          ),
        );
      }),

    openStorageInstance: (input) =>
      Effect.gen(function* () {
        if (input.payload.scopeType === "account" && input.payload.accountId === undefined) {
          return yield* toSourceStoreError(
            "storage.open",
            "Account scope storage requires accountId",
            `workspace=${input.workspaceId}`,
          );
        }

        const workspaces = yield* rows.workspaces.list().pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromRowStore("storage.open.workspaces", error),
          ),
        );

        const now = Date.now();
        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const storageInstanceId =
          `storage_${crypto.randomUUID()}` as StorageInstance["id"];
        const ttlHours =
          input.payload.ttlHours !== undefined && Number.isFinite(input.payload.ttlHours)
            ? Math.max(1, Math.floor(input.payload.ttlHours))
            : DEFAULT_EPHEMERAL_TTL_HOURS;

        yield* Effect.tryPromise({
          try: () => initializeStorageInstanceFiles(options.stateRootDir, storageInstanceId),
          catch: (cause) =>
            toSourceStoreErrorFromCause(
              "storage.open_initialize",
              cause,
              `storageInstance=${storageInstanceId}`,
            ),
        });

        const nextStorageInstance: StorageInstance = {
          id: storageInstanceId,
          scopeType: input.payload.scopeType,
          durability: input.payload.durability,
          status: "active",
          provider: input.payload.provider ?? "agentfs-local",
          backendKey: `local:${storageInstanceId}`,
          organizationId,
          workspaceId:
            input.payload.scopeType === "workspace" || input.payload.scopeType === "scratch"
              ? input.workspaceId
              : null,
          accountId:
            input.payload.scopeType === "account"
              ? (input.payload.accountId ?? null)
              : null,
          createdByAccountId: input.payload.accountId ?? null,
          purpose:
            input.payload.purpose !== undefined && input.payload.purpose.trim().length > 0
              ? input.payload.purpose.trim()
              : null,
          sizeBytes: null,
          fileCount: null,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          closedAt: null,
          expiresAt:
            input.payload.durability === "ephemeral"
              ? now + ttlHours * MILLIS_PER_HOUR
              : null,
        };

        yield* rows.storageInstances.upsert(nextStorageInstance).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromRowStore("storage.open_write", error),
          ),
        );

        return nextStorageInstance;
      }),

    closeStorageInstance: (input) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.close.instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.close.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const found = findStorageInstance(storageInstances, organizationId, {
          workspaceId: input.workspaceId,
          storageInstanceId: input.storageInstanceId,
        });

        if (found === null) {
          return yield* toSourceStoreError(
            "storage.close",
            "Storage instance not found",
            `workspace=${input.workspaceId} id=${input.storageInstanceId}`,
          );
        }

        const now = Date.now();

        const nextStorageInstance: StorageInstance = {
          ...found.storageInstance,
          status: "closed",
          updatedAt: now,
          lastSeenAt: now,
          closedAt: found.storageInstance.closedAt ?? now,
        };

        yield* rows.storageInstances.upsert(nextStorageInstance).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromRowStore("storage.close_write", error),
          ),
        );

        return nextStorageInstance;
      }),

    removeStorageInstance: (input) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.remove.instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.remove.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const found = findStorageInstance(storageInstances, organizationId, {
          workspaceId: input.workspaceId,
          storageInstanceId: input.storageInstanceId,
        });

        if (found === null) {
          return {
            removed: false,
          };
        }

        yield* Effect.tryPromise({
          try: () =>
            rm(storageInstanceRootPath(options.stateRootDir, input.storageInstanceId), {
              recursive: true,
              force: true,
            }),
          catch: (cause) =>
            toSourceStoreErrorFromCause(
              "storage.remove_files",
              cause,
              `storageInstance=${input.storageInstanceId}`,
            ),
        });

        const removed = yield* rows.storageInstances.removeById(input.storageInstanceId).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromRowStore("storage.remove_write", error),
          ),
        );

        return {
          removed,
        };
      }),

    listStorageDirectory: (input) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.list_directory.instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.list_directory.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const found = findStorageInstance(storageInstances, organizationId, {
          workspaceId: input.workspaceId,
          storageInstanceId: input.storageInstanceId,
        });

        if (found === null) {
          return yield* toSourceStoreError(
            "storage.listDirectory",
            "Storage instance not found",
            `workspace=${input.workspaceId} id=${input.storageInstanceId}`,
          );
        }

        const fsRootPath = storageInstanceFsRootPath(
          options.stateRootDir,
          found.storageInstance.id,
        );

        const result = yield* Effect.tryPromise({
          try: async () => {
            await mkdir(fsRootPath, { recursive: true });

            const resolved = resolvePathWithinRoot(
              fsRootPath,
              input.payload.path,
            );

            const entries = await readdir(resolved.absolutePath, {
              withFileTypes: true,
            });

            const mapped = await Promise.all(
              entries.map(async (entry) => {
                const entryAbsolutePath = path.resolve(
                  resolved.absolutePath,
                  entry.name,
                );
                const entryStat = await stat(entryAbsolutePath);

                return {
                  name: entry.name,
                  path: toStorageEntryPath(entryAbsolutePath, fsRootPath),
                  kind: entry.isDirectory() ? "directory" : "file",
                  sizeBytes: entry.isDirectory() ? null : entryStat.size,
                  updatedAt: entryStat.mtimeMs,
                } as const;
              }),
            );

            mapped.sort((left, right) => {
              if (left.kind !== right.kind) {
                return left.kind === "directory" ? -1 : 1;
              }

              return left.name.localeCompare(right.name);
            });

            return {
              path: resolved.normalizedPath,
              entries: mapped,
            };
          },
          catch: (cause) =>
            toSourceStoreErrorFromCause(
              "storage.listDirectory_read",
              cause,
              `storageInstance=${found.storageInstance.id} path=${input.payload.path}`,
            ),
        });

        yield* touchStorageInstance(
          rows,
          found.storageInstance,
          "storage.listDirectory_touch",
        );

        return result;
      }),

    readStorageFile: (input) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.read_file.instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.read_file.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const found = findStorageInstance(storageInstances, organizationId, {
          workspaceId: input.workspaceId,
          storageInstanceId: input.storageInstanceId,
        });

        if (found === null) {
          return yield* toSourceStoreError(
            "storage.readFile",
            "Storage instance not found",
            `workspace=${input.workspaceId} id=${input.storageInstanceId}`,
          );
        }

        const fsRootPath = storageInstanceFsRootPath(
          options.stateRootDir,
          found.storageInstance.id,
        );
        const encoding = input.payload.encoding ?? "utf8";

        const result = yield* Effect.tryPromise({
          try: async () => {
            await mkdir(fsRootPath, { recursive: true });

            const resolved = resolvePathWithinRoot(fsRootPath, input.payload.path);
            const entryStat = await stat(resolved.absolutePath);

            if (entryStat.isDirectory()) {
              throw new Error("Cannot read a directory");
            }

            const contentBuffer = await readFile(resolved.absolutePath);

            return {
              path: resolved.normalizedPath,
              encoding,
              content:
                encoding === "base64"
                  ? contentBuffer.toString("base64")
                  : contentBuffer.toString("utf8"),
              bytes: contentBuffer.byteLength,
            };
          },
          catch: (cause) =>
            toSourceStoreErrorFromCause(
              "storage.readFile_read",
              cause,
              `storageInstance=${found.storageInstance.id} path=${input.payload.path}`,
            ),
        });

        yield* touchStorageInstance(rows, found.storageInstance, "storage.readFile_touch");

        return result;
      }),

    listStorageKv: (input) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.list_kv.instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.list_kv.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const found = findStorageInstance(storageInstances, organizationId, {
          workspaceId: input.workspaceId,
          storageInstanceId: input.storageInstanceId,
        });

        if (found === null) {
          return yield* toSourceStoreError(
            "storage.listKv",
            "Storage instance not found",
            `workspace=${input.workspaceId} id=${input.storageInstanceId}`,
          );
        }

        const kvPath = storageInstanceKvPath(
          options.stateRootDir,
          found.storageInstance.id,
        );

        const result = yield* Effect.tryPromise({
          try: async () => {
            const kvStore = await readKvStore(kvPath);
            const prefix = input.payload.prefix ?? "";
            const requestedLimit =
              input.payload.limit !== undefined && Number.isFinite(input.payload.limit)
                ? Math.floor(input.payload.limit)
                : DEFAULT_KV_LIMIT;
            const limit = Math.max(1, Math.min(MAX_KV_LIMIT, requestedLimit));

            const items = Object.entries(kvStore)
              .filter(([key]) => key.startsWith(prefix))
              .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
              .slice(0, limit)
              .map(([key, value]) => ({ key, value }));

            return {
              items,
            };
          },
          catch: (cause) =>
            toSourceStoreErrorFromCause(
              "storage.listKv_read",
              cause,
              `storageInstance=${found.storageInstance.id}`,
            ),
        });

        yield* touchStorageInstance(rows, found.storageInstance, "storage.listKv_touch");

        return result;
      }),

    queryStorageSql: (input) =>
      Effect.gen(function* () {
        const [storageInstances, workspaces] = yield* Effect.all([
          rows.storageInstances.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.query_sql.instances", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("storage.query_sql.workspaces", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const found = findStorageInstance(storageInstances, organizationId, {
          workspaceId: input.workspaceId,
          storageInstanceId: input.storageInstanceId,
        });

        if (found === null) {
          return yield* toSourceStoreError(
            "storage.querySql",
            "Storage instance not found",
            `workspace=${input.workspaceId} id=${input.storageInstanceId}`,
          );
        }

        const sqlText = input.payload.sql.trim();
        if (sqlText.length === 0) {
          return yield* toSourceStoreError(
            "storage.querySql",
            "SQL query is required",
            `workspace=${input.workspaceId} id=${input.storageInstanceId}`,
          );
        }

        const sqlitePath = storageInstanceSqlitePath(
          options.stateRootDir,
          found.storageInstance.id,
        );

        const result = yield* Effect.tryPromise({
          try: async () => {
            await mkdir(path.dirname(sqlitePath), { recursive: true });

            const SqliteDatabase = await loadSqliteDatabase();
            if (SqliteDatabase === null) {
              throw new Error("SQLite runtime is unavailable in this environment");
            }

            const db = new SqliteDatabase(sqlitePath, { create: true });

            try {
              db.exec(
                "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
              );

              const maxRows =
                input.payload.maxRows !== undefined && Number.isFinite(input.payload.maxRows)
                  ? Math.max(1, Math.min(MAX_SQL_MAX_ROWS, Math.floor(input.payload.maxRows)))
                  : DEFAULT_SQL_MAX_ROWS;

              try {
                const statement = db.query(sqlText);
                const rawRows = statement.all() as Array<Record<string, unknown>>;
                const rowsLimited = rawRows.slice(0, maxRows);
                const columns =
                  rowsLimited.length > 0
                    ? Array.from(new Set(rowsLimited.flatMap((row) => Object.keys(row))))
                    : [];

                return {
                  rows: rowsLimited,
                  columns,
                  rowCount: rowsLimited.length,
                };
              } catch {
                db.run(sqlText);

                return {
                  rows: [],
                  columns: [],
                  rowCount: 0,
                };
              }
            } finally {
              db.close();
            }
          },
          catch: (cause) =>
            toSourceStoreErrorFromCause(
              "storage.querySql_run",
              cause,
              `storageInstance=${found.storageInstance.id}`,
            ),
        });

        yield* touchStorageInstance(rows, found.storageInstance, "storage.querySql_touch");

        return result;
      }),
  });
