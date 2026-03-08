ALTER TABLE "tool_artifacts" ADD COLUMN "openapi_raw_tool_id" text;--> statement-breakpoint
ALTER TABLE "tool_artifacts" ADD COLUMN "openapi_operation_id" text;--> statement-breakpoint
ALTER TABLE "tool_artifacts" ADD COLUMN "openapi_tags_json" text;--> statement-breakpoint
UPDATE "tool_artifacts"
SET
  "openapi_raw_tool_id" = "tool_id",
  "openapi_operation_id" = "tool_id",
  "openapi_tags_json" = '[]'
WHERE "provider_kind" = 'openapi';--> statement-breakpoint
ALTER TABLE "tool_artifacts" DROP CONSTRAINT "tool_artifacts_mcp_shape_check";--> statement-breakpoint
ALTER TABLE "tool_artifacts" DROP CONSTRAINT "tool_artifacts_openapi_shape_check";--> statement-breakpoint
ALTER TABLE "tool_artifacts"
ADD CONSTRAINT "tool_artifacts_mcp_shape_check" CHECK (
  "provider_kind" <> 'mcp'
  OR (
    "mcp_tool_name" is not null
    and "openapi_method" is null
    and "openapi_path_template" is null
    and "openapi_operation_hash" is null
    and "openapi_raw_tool_id" is null
    and "openapi_operation_id" is null
    and "openapi_tags_json" is null
    and "openapi_request_body_required" is null
  )
);--> statement-breakpoint
ALTER TABLE "tool_artifacts"
ADD CONSTRAINT "tool_artifacts_openapi_shape_check" CHECK (
  "provider_kind" <> 'openapi'
  OR (
    "mcp_tool_name" is null
    and "openapi_method" in ('get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace')
    and "openapi_path_template" is not null
    and "openapi_operation_hash" is not null
    and "openapi_raw_tool_id" is not null
    and "openapi_tags_json" is not null
  )
);
