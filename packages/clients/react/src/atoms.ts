import type { ScopeId, ToolId, SecretId } from "@executor/sdk";
import { ScopeId as ScopeIdSchema } from "@executor/sdk";

import { getExecutorClient } from "./client";

// ---------------------------------------------------------------------------
// Query atoms — typed, cached, reactive
// ---------------------------------------------------------------------------

const DEFAULT_SCOPE = ScopeIdSchema.make("default");

export const toolsAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  getExecutorClient().query("tools", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
  });

export const toolSchemaAtom = (scopeId: ScopeId, toolId: ToolId) =>
  getExecutorClient().query("tools", "schema", {
    path: { scopeId, toolId },
    timeToLive: "1 minute",
  });

export const secretsAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  getExecutorClient().query("secrets", "list", {
    path: { scopeId },
    timeToLive: "30 seconds",
  });

export const secretStatusAtom = (scopeId: ScopeId, secretId: SecretId) =>
  getExecutorClient().query("secrets", "status", {
    path: { scopeId, secretId },
    timeToLive: "15 seconds",
  });

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const invokeTool = getExecutorClient().mutation("tools", "invoke");

export const setSecret = getExecutorClient().mutation("secrets", "set");

export const removeSecret = getExecutorClient().mutation("secrets", "remove");
