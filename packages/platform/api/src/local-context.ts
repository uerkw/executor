import type { WorkspaceId } from "@executor/platform-sdk/schema";
import * as Effect from "effect/Effect";

import {
  RuntimeLocalWorkspaceMismatchError,
  requireRuntimeLocalWorkspace,
} from "@executor/platform-sdk/runtime";
import { ControlPlaneForbiddenError } from "./errors";

export const resolveRequestedLocalWorkspace = (
  operation: string,
  workspaceId: WorkspaceId,
) =>
  requireRuntimeLocalWorkspace(workspaceId).pipe(
    Effect.mapError((cause) =>
      new ControlPlaneForbiddenError({
        operation,
        message: "Requested workspace is not the active local workspace",
        details:
          cause instanceof RuntimeLocalWorkspaceMismatchError
            ? `requestedWorkspaceId=${cause.requestedWorkspaceId} activeWorkspaceId=${cause.activeWorkspaceId}`
            : "Runtime local workspace is unavailable",
      })
    ),
  );
