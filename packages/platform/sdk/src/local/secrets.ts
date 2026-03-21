import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SecretMaterialIdSchema } from "../schema";
import {
  type CreateSecretPayload,
  type CreateSecretResult,
  type DeleteSecretResult,
  type InstanceConfig,
  type SecretListItem,
  type UpdateSecretPayload,
  type UpdateSecretResult,
} from "./contracts";
import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../errors";
import { requireRuntimeLocalWorkspace } from "../runtime/local/runtime-context";
import {
  createDefaultSecretMaterialDeleter,
  createDefaultSecretMaterialStorer,
  createDefaultSecretMaterialUpdater,
  ENV_SECRET_PROVIDER_ID,
  KEYCHAIN_SECRET_PROVIDER_ID,
  LOCAL_SECRET_PROVIDER_ID,
  parseSecretStoreProviderId,
  resolveDefaultSecretStoreProviderId,
} from "../runtime/local/secret-material-providers";
import { RuntimeSourceStoreService } from "../runtime/sources/source-store";
import { ControlPlaneStore } from "../runtime/store";

const SECRET_STORE_PROVIDER_ENV = "EXECUTOR_SECRET_STORE_PROVIDER";

const secretStorageError = (operation: string, message: string) =>
  new ControlPlaneStorageError({
    operation,
    message,
    details: message,
  });

export const getLocalInstanceConfig = (): Effect.Effect<InstanceConfig> => {
  const explicitDefaultStoreProvider = parseSecretStoreProviderId(
    process.env[SECRET_STORE_PROVIDER_ENV],
  );
  const providers = [
    {
      id: LOCAL_SECRET_PROVIDER_ID,
      name: "Local store",
      canStore: true,
    },
  ];

  if (process.platform === "darwin" || process.platform === "linux") {
    providers.push({
      id: KEYCHAIN_SECRET_PROVIDER_ID,
      name:
        process.platform === "darwin" ? "macOS Keychain" : "Desktop Keyring",
      canStore:
        process.platform === "darwin" ||
        explicitDefaultStoreProvider === KEYCHAIN_SECRET_PROVIDER_ID,
    });
  }

  providers.push({
    id: ENV_SECRET_PROVIDER_ID,
    name: "Environment variable",
    canStore: false,
  });

  return resolveDefaultSecretStoreProviderId({
    storeProviderId: explicitDefaultStoreProvider ?? undefined,
  }).pipe(
    Effect.map((resolvedDefaultStoreProvider) => ({
      platform: process.platform,
      secretProviders: providers,
      defaultSecretStoreProvider: resolvedDefaultStoreProvider,
    })),
  );
};

export const listLocalSecrets = () =>
  Effect.gen(function* () {
    const store = yield* ControlPlaneStore;
    const sourceStore = yield* RuntimeSourceStoreService;
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace().pipe(
      Effect.mapError(() =>
        secretStorageError("secrets.list", "Failed resolving local workspace."),
      ),
    );
    const rows = yield* store.secretMaterials
      .listAll()
      .pipe(
        Effect.mapError(() =>
          secretStorageError("secrets.list", "Failed listing secrets."),
        ),
      );
    const linkedSourcesMap = yield* sourceStore
      .listLinkedSecretSourcesInWorkspace(
        runtimeLocalWorkspace.installation.workspaceId,
        {
          actorAccountId: runtimeLocalWorkspace.installation.accountId,
        },
      )
      .pipe(
        Effect.mapError(() =>
          secretStorageError("secrets.list", "Failed loading linked sources."),
        ),
      );

    return rows.map((row) => ({
      ...row,
      linkedSources: linkedSourcesMap.get(row.id) ?? [],
    }));
  });

export const createLocalSecret = (payload: CreateSecretPayload) =>
  Effect.gen(function* () {
    const name = payload.name.trim();
    const value = payload.value;
    const purpose = payload.purpose ?? "auth_material";
    const requestedProviderId =
      payload.providerId === undefined
        ? null
        : parseSecretStoreProviderId(payload.providerId);

    if (name.length === 0) {
      return yield* new ControlPlaneBadRequestError({
        operation: "secrets.create",
        message: "Secret name is required.",
        details: "Secret name is required.",
      });
    }
    if (payload.providerId !== undefined && requestedProviderId === null) {
      return yield* new ControlPlaneBadRequestError({
        operation: "secrets.create",
        message: `Unsupported secret provider: ${payload.providerId}`,
        details: `Unsupported secret provider: ${payload.providerId}`,
      });
    }

    const store = yield* ControlPlaneStore;
    const storeSecretMaterial = createDefaultSecretMaterialStorer({
      rows: store,
      ...(requestedProviderId ? { storeProviderId: requestedProviderId } : {}),
    });
    const ref = yield* storeSecretMaterial({
      name,
      purpose,
      value,
    }).pipe(
      Effect.mapError((cause) =>
        secretStorageError(
          "secrets.create",
          cause instanceof Error ? cause.message : "Failed creating secret.",
        ),
      ),
    );
    const secretId = SecretMaterialIdSchema.make(ref.handle);
    const created = yield* store.secretMaterials
      .getById(secretId)
      .pipe(
        Effect.mapError(() =>
          secretStorageError(
            "secrets.create",
            "Failed loading created secret.",
          ),
        ),
      );

    if (Option.isNone(created)) {
      return yield* secretStorageError(
        "secrets.create",
        `Created secret not found: ${ref.handle}`,
      );
    }

    return {
      id: created.value.id,
      name: created.value.name,
      providerId: created.value.providerId,
      purpose: created.value.purpose,
      createdAt: created.value.createdAt,
      updatedAt: created.value.updatedAt,
    } satisfies CreateSecretResult;
  });

export const updateLocalSecret = (input: {
  secretId: string;
  payload: UpdateSecretPayload;
}) =>
  Effect.gen(function* () {
    const secretId = SecretMaterialIdSchema.make(input.secretId);
    const store = yield* ControlPlaneStore;

    const existing = yield* store.secretMaterials
      .getById(secretId)
      .pipe(
        Effect.mapError(() =>
          secretStorageError("secrets.update", "Failed looking up secret."),
        ),
      );

    if (Option.isNone(existing)) {
      return yield* new ControlPlaneNotFoundError({
        operation: "secrets.update",
        message: `Secret not found: ${input.secretId}`,
        details: `Secret not found: ${input.secretId}`,
      });
    }

    const update: { name?: string | null; value?: string } = {};
    if (input.payload.name !== undefined)
      update.name = input.payload.name.trim() || null;
    if (input.payload.value !== undefined) update.value = input.payload.value;

    const updateSecretMaterial = createDefaultSecretMaterialUpdater({
      rows: store,
    });
    const updated = yield* updateSecretMaterial({
      ref: {
        providerId: existing.value.providerId,
        handle: existing.value.id,
      },
      ...update,
    }).pipe(
      Effect.mapError(() =>
        secretStorageError("secrets.update", "Failed updating secret."),
      ),
    );

    return {
      id: updated.id,
      providerId: updated.providerId,
      name: updated.name,
      purpose: updated.purpose,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    } satisfies UpdateSecretResult;
  });

export const deleteLocalSecret = (secretId: string) =>
  Effect.gen(function* () {
    const parsedSecretId = SecretMaterialIdSchema.make(secretId);
    const store = yield* ControlPlaneStore;

    const existing = yield* store.secretMaterials
      .getById(parsedSecretId)
      .pipe(
        Effect.mapError(() =>
          secretStorageError("secrets.delete", "Failed looking up secret."),
        ),
      );

    if (Option.isNone(existing)) {
      return yield* new ControlPlaneNotFoundError({
        operation: "secrets.delete",
        message: `Secret not found: ${secretId}`,
        details: `Secret not found: ${secretId}`,
      });
    }

    const deleteSecretMaterial = createDefaultSecretMaterialDeleter({
      rows: store,
    });
    const removed = yield* deleteSecretMaterial({
      providerId: existing.value.providerId,
      handle: existing.value.id,
    }).pipe(
      Effect.mapError(() =>
        secretStorageError("secrets.delete", "Failed removing secret."),
      ),
    );

    if (!removed) {
      return yield* secretStorageError(
        "secrets.delete",
        `Failed removing secret: ${secretId}`,
      );
    }

    return { removed: true } satisfies DeleteSecretResult;
  });
