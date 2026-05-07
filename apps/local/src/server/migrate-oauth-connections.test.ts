import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";

const MIGRATION = join(import.meta.dirname, "../../drizzle/0008_scoped_credentials_cutover.sql");

let workDir: string;
let db: Database;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "executor-oauth-conn-mig-"));
  db = new Database(join(workDir, "data.db"));
  db.exec(`
    CREATE TABLE \`connection\` (
      \`id\` text NOT NULL,
      \`scope_id\` text NOT NULL,
      \`provider\` text NOT NULL,
      \`provider_state\` text,
      \`scope\` text,
      \`updated_at\` integer NOT NULL
    );
  `);
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

const ConnectionRow = Schema.Struct({
  provider: Schema.String,
  provider_state: Schema.String,
});
const decodeConnectionRows = Schema.decodeUnknownSync(Schema.Array(ConnectionRow));
const decodeJsonRecord = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const oauthConnectionMigrationSql = () => {
  const sql = readFileSync(MIGRATION, "utf-8");
  const start = sql.indexOf("-- 0013_normalize_oauth_connections.sql");
  const end = sql.indexOf("-- 0014_openapi_header_rows.sql", start);
  if (start < 0 || end < 0) {
    // oxlint-disable-next-line executor/no-try-catch-or-throw, executor/no-error-constructor -- boundary: test fixture helper must fail fast when the migration section marker changes
    throw new Error("OAuth connection migration section not found");
  }
  return sql.slice(start, end);
};

describe("0008_scoped_credentials_cutover OAuth connection section", () => {
  it("rewrites old OAuth provider keys and provider_state into the canonical oauth2 shape", () => {
    const now = Date.now();
    const insert = db.prepare(
      "INSERT INTO `connection` (id, scope_id, provider, provider_state, scope, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "openapi-conn",
      "scope-1",
      "openapi:oauth2",
      JSON.stringify({
        flow: "authorizationCode",
        tokenUrl: "https://openapi.example.com/token",
        clientIdSecretId: "openapi-client-id",
        clientSecretSecretId: null,
        scopes: ["read"],
      }),
      "read",
      now,
    );
    insert.run(
      "mcp-conn",
      "scope-1",
      "mcp:oauth2",
      JSON.stringify({
        endpoint: "https://mcp.example.com/mcp",
        tokenEndpoint: "https://mcp.example.com/token",
        clientInformation: {
          client_id: "mcp-client",
          token_endpoint_auth_method: "client_secret_basic",
        },
      }),
      null,
      now,
    );
    insert.run(
      "google-conn",
      "scope-1",
      "google-discovery:oauth2",
      JSON.stringify({
        clientIdSecretId: "google-client-id",
        clientSecretSecretId: "google-client-secret",
        scopes: ["https://www.googleapis.com/auth/drive"],
      }),
      "https://www.googleapis.com/auth/drive",
      now,
    );

    db.exec(oauthConnectionMigrationSql());

    const rows = decodeConnectionRows(
      db.prepare("SELECT provider, provider_state FROM `connection` ORDER BY id").all(),
    );
    expect(rows.map((row) => row.provider)).toEqual(["oauth2", "oauth2", "oauth2"]);
    const [google, mcp, openapi] = rows.map((row) => decodeJsonRecord(row.provider_state));
    expect(google).toMatchObject({
      kind: "authorization-code",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      clientIdSecretId: "google-client-id",
    });
    expect(mcp).toMatchObject({
      kind: "dynamic-dcr",
      tokenEndpoint: "https://mcp.example.com/token",
      clientId: "mcp-client",
      clientAuth: "basic",
      resource: "https://mcp.example.com/mcp",
    });
    expect(openapi).toMatchObject({
      kind: "authorization-code",
      tokenEndpoint: "https://openapi.example.com/token",
      clientIdSecretId: "openapi-client-id",
      scopes: ["read"],
      scope: "read",
    });
  });
});
