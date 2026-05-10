import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import {
  LocalDatabaseMigrationHistoryMismatch,
  LocalDatabaseSchemaTooNew,
  checkDrizzleMigrationCompatibility,
  readAppliedDrizzleMigrationHashes,
  readBundledDrizzleMigrationHashes,
} from "./executor";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../drizzle");

const workDirs: string[] = [];

const tempDb = (): { db: Database; path: string } => {
  const dir = mkdtempSync(join(tmpdir(), "executor-schema-compat-"));
  workDirs.push(dir);
  const path = join(dir, "data.db");
  return { db: new Database(path), path };
};

const createMigrationTable = (db: Database): void => {
  db.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
};

const insertMigrationHashes = (db: Database, hashes: ReadonlyArray<string>): void => {
  const stmt = db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  for (const [index, hash] of hashes.entries()) {
    stmt.run(hash, index + 1);
  }
};

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Drizzle migration compatibility preflight", () => {
  it("allows a fresh DB without __drizzle_migrations", () => {
    const { db, path } = tempDb();
    try {
      expect(() =>
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        }),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("allows an existing but empty __drizzle_migrations table", () => {
    const { db, path } = tempDb();
    try {
      createMigrationTable(db);

      expect(() =>
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        }),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("computes bundled hashes that exactly match hashes written by Drizzle", () => {
    const { db } = tempDb();
    try {
      migrate(drizzle(db), { migrationsFolder: MIGRATIONS_FOLDER });

      expect(readAppliedDrizzleMigrationHashes(db)).toEqual(
        readBundledDrizzleMigrationHashes(MIGRATIONS_FOLDER),
      );
    } finally {
      db.close();
    }
  });

  it("throws LocalDatabaseSchemaTooNew when the DB has more migrations than the binary", () => {
    const { db, path } = tempDb();
    try {
      const bundled = readBundledDrizzleMigrationHashes(MIGRATIONS_FOLDER);
      createMigrationTable(db);
      insertMigrationHashes(db, [...bundled, "future-migration-hash"]);

      expect(() =>
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        }),
      ).toThrow(LocalDatabaseSchemaTooNew);

      try {
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(LocalDatabaseSchemaTooNew);
        expect((error as Error).message).toContain(
          "This Executor binary is older than the schema",
        );
        expect((error as Error).message).toContain("Use a newer Executor binary");
      }
    } finally {
      db.close();
    }
  });

  it("throws LocalDatabaseMigrationHistoryMismatch when hashes diverge", () => {
    const { db, path } = tempDb();
    try {
      const bundled = readBundledDrizzleMigrationHashes(MIGRATIONS_FOLDER);
      createMigrationTable(db);
      insertMigrationHashes(db, ["different-migration-hash", ...bundled.slice(1)]);

      expect(() =>
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        }),
      ).toThrow(LocalDatabaseMigrationHistoryMismatch);

      try {
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(LocalDatabaseMigrationHistoryMismatch);
        expect((error as Error).message).toContain(
          "does not match this Executor build",
        );
        expect((error as Error).message).toContain("restore a backup");
      }
    } finally {
      db.close();
    }
  });

  it("allows an older DB whose migration history is a bundled prefix", () => {
    const { db, path } = tempDb();
    try {
      const bundled = readBundledDrizzleMigrationHashes(MIGRATIONS_FOLDER);
      createMigrationTable(db);
      insertMigrationHashes(db, bundled.slice(0, 1));

      expect(() =>
        checkDrizzleMigrationCompatibility({
          sqlite: db,
          dbPath: path,
          migrationsFolder: MIGRATIONS_FOLDER,
        }),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});
