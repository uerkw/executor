CREATE TABLE "tool_artifact_parameters" (
	"workspace_id" text,
	"path" text,
	"position" bigint,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"required" boolean NOT NULL,
	CONSTRAINT "tool_artifact_parameters_pkey" PRIMARY KEY("workspace_id","path","position"),
	CONSTRAINT "tool_artifact_parameters_location_check" CHECK ("location" in ('path', 'query', 'header', 'cookie'))
);
--> statement-breakpoint
CREATE TABLE "tool_artifact_ref_hint_keys" (
	"workspace_id" text,
	"path" text,
	"position" bigint,
	"ref_hint_key" text NOT NULL,
	CONSTRAINT "tool_artifact_ref_hint_keys_pkey" PRIMARY KEY("workspace_id","path","position")
);
--> statement-breakpoint
CREATE TABLE "tool_artifact_request_body_content_types" (
	"workspace_id" text,
	"path" text,
	"position" bigint,
	"content_type" text NOT NULL,
	CONSTRAINT "tool_artifact_request_body_content_types_pkey" PRIMARY KEY("workspace_id","path","position")
);
--> statement-breakpoint
CREATE TABLE "tool_artifacts" (
	"workspace_id" text,
	"path" text,
	"tool_id" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text,
	"description" text,
	"search_namespace" text NOT NULL,
	"search_text" text NOT NULL,
	"input_schema_json" text,
	"output_schema_json" text,
	"provider_kind" text NOT NULL,
	"mcp_tool_name" text,
	"openapi_method" text,
	"openapi_path_template" text,
	"openapi_operation_hash" text,
	"openapi_request_body_required" boolean,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "tool_artifacts_pkey" PRIMARY KEY("workspace_id","path"),
	CONSTRAINT "tool_artifacts_provider_kind_check" CHECK ("provider_kind" in ('mcp', 'openapi')),
	CONSTRAINT "tool_artifacts_mcp_shape_check" CHECK ("provider_kind" <> 'mcp'
        or (
          "mcp_tool_name" is not null
          and "openapi_method" is null
          and "openapi_path_template" is null
          and "openapi_operation_hash" is null
          and "openapi_request_body_required" is null
        )),
	CONSTRAINT "tool_artifacts_openapi_shape_check" CHECK ("provider_kind" <> 'openapi'
        or (
          "mcp_tool_name" is null
          and "openapi_method" in ('get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace')
          and "openapi_path_template" is not null
          and "openapi_operation_hash" is not null
        ))
);
--> statement-breakpoint
CREATE INDEX "tool_artifact_parameters_lookup_idx" ON "tool_artifact_parameters" ("workspace_id","path","position");--> statement-breakpoint
CREATE INDEX "tool_artifact_ref_hint_keys_lookup_idx" ON "tool_artifact_ref_hint_keys" ("workspace_id","path","position");--> statement-breakpoint
CREATE INDEX "tool_artifact_request_body_content_types_lookup_idx" ON "tool_artifact_request_body_content_types" ("workspace_id","path","position");--> statement-breakpoint
CREATE INDEX "tool_artifacts_workspace_source_idx" ON "tool_artifacts" ("workspace_id","source_id","updated_at","path");--> statement-breakpoint
CREATE INDEX "tool_artifacts_workspace_namespace_idx" ON "tool_artifacts" ("workspace_id","search_namespace","path");