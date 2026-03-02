CREATE TABLE IF NOT EXISTS profile (
  id BIGINT PRIMARY KEY,
  schema_version BIGINT NOT NULL,
  generated_at BIGINT NOT NULL,
  profile_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (id = 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sources (
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, source_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sources_workspace_name_idx
ON sources (workspace_id, name);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tool_artifacts (
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, source_id)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS source_auth_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth_materials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS storage_instances (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NULL,
  payload_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  event_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS events_workspace_sequence_idx
ON events (workspace_id, sequence);
