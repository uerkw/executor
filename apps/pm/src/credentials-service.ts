import { SourceStoreError } from "@executor-v2/persistence-ports";
import { type SqlControlPlanePersistence } from "@executor-v2/persistence-sql";
import {
  makeControlPlaneCredentialsService,
  type ControlPlaneCredentialsServiceShape,
  type UpsertCredentialBindingPayload,
} from "@executor-v2/management-api";
import {
  type AuthConnection,
  type AuthConnectionStrategy,
  type AuthMaterial,
  type OAuthState,
  type OrganizationId,
  type SourceAuthBinding,
  type SourceCredentialBinding,
  type Workspace,
  type WorkspaceId,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";

type CredentialRows = Pick<
  SqlControlPlanePersistence["rows"],
  | "workspaces"
  | "authConnections"
  | "sourceAuthBindings"
  | "authMaterials"
  | "oauthStates"
>;

const toSourceStoreError = (
  operation: string,
  message: string,
  details: string | null,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    backend: "sql",
    location: "credentials",
    message,
    reason: null,
    details,
  });

const toSourceStoreErrorFromRowStore = (
  operation: string,
  error: { message: string; details: string | null; reason: string | null },
): SourceStoreError =>
  toSourceStoreError(operation, error.message, error.details ?? error.reason ?? null);

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

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sourceIdFromSourceKey = (sourceKey: string): string | null => {
  const trimmed = sourceKey.trim();
  if (!trimmed.startsWith("source:")) {
    return null;
  }

  const sourceId = trimmed.slice("source:".length).trim();
  return sourceId.length > 0 ? sourceId : null;
};

const sourceKeyFromSourceId = (sourceId: string): string => `source:${sourceId}`;

const strategyFromProvider = (
  provider: SourceCredentialBinding["provider"],
): AuthConnectionStrategy => {
  if (provider === "api_key") return "api_key";
  if (provider === "bearer") return "bearer";
  if (provider === "oauth2") return "oauth2";
  if (provider === "basic") return "basic";
  return "custom";
};

const providerFromStrategy = (
  strategy: AuthConnectionStrategy,
): SourceCredentialBinding["provider"] => {
  if (strategy === "api_key") return "api_key";
  if (strategy === "bearer") return "bearer";
  if (strategy === "oauth2") return "oauth2";
  if (strategy === "basic") return "basic";
  return "custom";
};

const maskedSecretRef = (connection: AuthConnection): string => {
  if (connection.strategy === "oauth2") {
    if (connection.status === "reauth_required") {
      return "oauth2://reauth_required";
    }

    if (connection.status === "active") {
      return "oauth2://connected";
    }
  }

  return "********";
};

const toCompatSourceCredentialBinding = (
  binding: SourceAuthBinding,
  connection: AuthConnection,
): SourceCredentialBinding => ({
  id: binding.id as unknown as SourceCredentialBinding["id"],
  credentialId: connection.id as unknown as SourceCredentialBinding["credentialId"],
  organizationId: binding.organizationId,
  workspaceId: binding.workspaceId,
  accountId: binding.accountId,
  scopeType: binding.scopeType,
  sourceKey: sourceKeyFromSourceId(binding.sourceId),
  provider: providerFromStrategy(connection.strategy),
  secretProvider: "local",
  secretRef: maskedSecretRef(connection),
  additionalHeadersJson: connection.additionalHeadersJson,
  boundAuthFingerprint: null,
  createdAt: binding.createdAt,
  updatedAt: Math.max(binding.updatedAt, connection.updatedAt),
});

const sortCredentialBindings = (
  bindings: ReadonlyArray<SourceCredentialBinding>,
): Array<SourceCredentialBinding> =>
  [...bindings].sort((left, right) => {
    const leftKey = `${left.sourceKey}:${left.provider}:${left.id}`.toLowerCase();
    const rightKey = `${right.sourceKey}:${right.provider}:${right.id}`.toLowerCase();
    return leftKey.localeCompare(rightKey);
  });

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

type OAuthRefreshConfig = {
  tokenEndpoint?: string;
  authorizationServer?: string;
  clientId?: string;
  clientSecretCiphertext?: string;
  sourceUrl?: string;
  clientInformationJson?: string;
};

const parseOAuthRefreshConfig = (value: string | null): OAuthRefreshConfig => {
  if (!value) {
    return {};
  }

  const parsed = parseJsonObject(value);
  return {
    ...(normalizeString(parsed.tokenEndpoint)
      ? { tokenEndpoint: normalizeString(parsed.tokenEndpoint)! }
      : {}),
    ...(normalizeString(parsed.authorizationServer)
      ? { authorizationServer: normalizeString(parsed.authorizationServer)! }
      : {}),
    ...(normalizeString(parsed.clientId)
      ? { clientId: normalizeString(parsed.clientId)! }
      : {}),
    ...(normalizeString(parsed.clientSecretCiphertext)
      ? { clientSecretCiphertext: normalizeString(parsed.clientSecretCiphertext)! }
      : {}),
    ...(normalizeString(parsed.sourceUrl)
      ? { sourceUrl: normalizeString(parsed.sourceUrl)! }
      : {}),
    ...(normalizeString(parsed.clientInformationJson)
      ? { clientInformationJson: normalizeString(parsed.clientInformationJson)! }
      : {}),
  };
};

const encodeOAuthRefreshConfig = (config: OAuthRefreshConfig): string | null => {
  const payload: Record<string, string> = {};

  if (config.tokenEndpoint) payload.tokenEndpoint = config.tokenEndpoint;
  if (config.authorizationServer) payload.authorizationServer = config.authorizationServer;
  if (config.clientId) payload.clientId = config.clientId;
  if (config.clientSecretCiphertext) payload.clientSecretCiphertext = config.clientSecretCiphertext;
  if (config.sourceUrl) payload.sourceUrl = config.sourceUrl;
  if (config.clientInformationJson) payload.clientInformationJson = config.clientInformationJson;

  if (Object.keys(payload).length === 0) {
    return null;
  }

  return JSON.stringify(payload);
};

const buildOAuthRefreshConfigFromPayload = (
  payload: UpsertCredentialBindingPayload,
  existing: OAuthRefreshConfig,
): OAuthRefreshConfig => ({
  tokenEndpoint:
    normalizeString(payload.oauthTokenEndpoint)
    ?? existing.tokenEndpoint,
  authorizationServer:
    normalizeString(payload.oauthAuthorizationServer)
    ?? existing.authorizationServer,
  clientId: normalizeString(payload.oauthClientId) ?? existing.clientId,
  clientSecretCiphertext:
    normalizeString(payload.oauthClientSecret)
    ?? existing.clientSecretCiphertext,
  sourceUrl: normalizeString(payload.oauthSourceUrl) ?? existing.sourceUrl,
  clientInformationJson:
    normalizeString(payload.oauthClientInformationJson)
    ?? existing.clientInformationJson,
});

export const createPmCredentialsService = (
  rows: CredentialRows,
): ControlPlaneCredentialsServiceShape =>
  makeControlPlaneCredentialsService({
    listCredentialBindings: (workspaceId) =>
      Effect.gen(function* () {
        const [bindings, connections, workspaces] = yield* Effect.all([
          rows.sourceAuthBindings.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.bindings.list", error),
            ),
          ),
          rows.authConnections.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.connections.list", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.workspaces.list", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, workspaceId);

        const scopedBindings = bindings.filter(
          (binding) =>
            binding.workspaceId === workspaceId
            || (binding.workspaceId === null && binding.organizationId === organizationId),
        );

        const compatBindings: Array<SourceCredentialBinding> = [];

        for (const binding of scopedBindings) {
          const connection = connections.find(
            (candidate) => candidate.id === binding.connectionId,
          );

          if (!connection) {
            continue;
          }

          compatBindings.push(toCompatSourceCredentialBinding(binding, connection));
        }

        return sortCredentialBindings(compatBindings);
      }),

    upsertCredentialBinding: (input) =>
      Effect.gen(function* () {
        const [bindings, connections, materials, oauthStates, workspaces] = yield* Effect.all([
          rows.sourceAuthBindings.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.bindings.list", error),
            ),
          ),
          rows.authConnections.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.connections.list", error),
            ),
          ),
          rows.authMaterials.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.materials.list", error),
            ),
          ),
          rows.oauthStates.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.oauth_states.list", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.workspaces.list", error),
            ),
          ),
        ]);

        if (input.payload.scopeType === "account" && input.payload.accountId === null) {
          return yield* toSourceStoreError(
            "credentials.upsert",
            "Account scope credentials require accountId",
            `workspace=${input.workspaceId}`,
          );
        }

        const sourceId = sourceIdFromSourceKey(input.payload.sourceKey);
        if (!sourceId) {
          return yield* toSourceStoreError(
            "credentials.upsert",
            "Credentials require sourceKey in the form 'source:<id>'",
            `workspace=${input.workspaceId}`,
          );
        }

        const now = Date.now();
        const requestedId = input.payload.id;
        const requestedBindingId = requestedId as SourceAuthBinding["id"] | undefined;

        const existingBinding = requestedBindingId
          ? bindings.find((binding) => binding.id === requestedBindingId) ?? null
          : null;

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);

        const scopeWorkspaceId =
          input.payload.scopeType === "workspace" ? input.workspaceId : null;
        const scopeAccountId =
          input.payload.scopeType === "account" ? (input.payload.accountId ?? null) : null;

        const resolvedBindingId = (
          existingBinding?.id
          ?? requestedBindingId
          ?? (`auth_binding_${crypto.randomUUID()}` as SourceAuthBinding["id"])
        ) as SourceAuthBinding["id"];

        const requestedConnectionId = (
          normalizeString(input.payload.credentialId)
          ?? existingBinding?.connectionId
          ?? (`conn_${crypto.randomUUID()}` as AuthConnection["id"])
        ) as AuthConnection["id"];

        const existingConnection = connections.find(
          (connection) => connection.id === requestedConnectionId,
        ) ?? null;

        if (existingConnection && existingConnection.organizationId !== organizationId) {
          return yield* toSourceStoreError(
            "credentials.upsert",
            "Connection id belongs to another organization",
            `workspace=${input.workspaceId}`,
          );
        }

        const nextConnection: AuthConnection = {
          id: requestedConnectionId,
          organizationId,
          workspaceId: scopeWorkspaceId,
          accountId: scopeAccountId,
          ownerType:
            input.payload.scopeType === "organization"
              ? "organization"
              : input.payload.scopeType === "account"
                ? "account"
                : "workspace",
          strategy: strategyFromProvider(input.payload.provider),
          displayName:
            normalizeString(existingConnection?.displayName)
            ?? sourceKeyFromSourceId(sourceId),
          status: "active",
          statusReason: null,
          lastAuthErrorClass: null,
          metadataJson: existingConnection?.metadataJson ?? null,
          additionalHeadersJson:
            input.payload.additionalHeadersJson !== undefined
              ? input.payload.additionalHeadersJson
              : existingConnection?.additionalHeadersJson ?? null,
          createdByAccountId: existingConnection?.createdByAccountId ?? null,
          createdAt: existingConnection?.createdAt ?? now,
          updatedAt: now,
          lastUsedAt: existingConnection?.lastUsedAt ?? null,
        };

        const nextBinding: SourceAuthBinding = {
          id: resolvedBindingId,
          sourceId: sourceId as SourceAuthBinding["sourceId"],
          connectionId: requestedConnectionId,
          organizationId,
          workspaceId: scopeWorkspaceId,
          accountId: scopeAccountId,
          scopeType: input.payload.scopeType,
          selector: existingBinding?.selector ?? null,
          enabled: true,
          createdAt: existingBinding?.createdAt ?? now,
          updatedAt: now,
        };

        yield* Effect.all([
          rows.authConnections.upsert(nextConnection),
          rows.sourceAuthBindings.upsert(nextBinding),
        ]).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromRowStore("credentials.upsert_rows", error),
          ),
        );

        if (nextConnection.strategy === "oauth2") {
          const existingOAuth = oauthStates.find(
            (state) => state.connectionId === requestedConnectionId,
          ) ?? null;
          const refreshConfig = buildOAuthRefreshConfigFromPayload(
            input.payload,
            parseOAuthRefreshConfig(existingOAuth?.refreshConfigJson ?? null),
          );

          const oauthState: OAuthState = {
            id:
              existingOAuth?.id
              ?? (`oauth_state_${crypto.randomUUID()}` as OAuthState["id"]),
            connectionId: requestedConnectionId,
            accessTokenCiphertext: input.payload.secretRef,
            refreshTokenCiphertext:
              input.payload.oauthRefreshToken !== undefined
                ? normalizeString(input.payload.oauthRefreshToken)
                : existingOAuth?.refreshTokenCiphertext ?? null,
            keyVersion: existingOAuth?.keyVersion ?? "local",
            expiresAt:
              input.payload.oauthExpiresAt !== undefined
                ? input.payload.oauthExpiresAt
                : existingOAuth?.expiresAt ?? null,
            scope:
              input.payload.oauthScope !== undefined
                ? input.payload.oauthScope
                : existingOAuth?.scope ?? null,
            tokenType: existingOAuth?.tokenType ?? "Bearer",
            issuer:
              input.payload.oauthIssuer !== undefined
                ? input.payload.oauthIssuer
                : existingOAuth?.issuer ?? null,
            refreshConfigJson: encodeOAuthRefreshConfig(refreshConfig),
            tokenVersion: (existingOAuth?.tokenVersion ?? 0) + 1,
            leaseHolder: null,
            leaseExpiresAt: null,
            leaseFence: existingOAuth?.leaseFence ?? 0,
            lastRefreshAt: existingOAuth?.lastRefreshAt ?? null,
            lastRefreshErrorClass: null,
            lastRefreshError: null,
            reauthRequiredAt: null,
            createdAt: existingOAuth?.createdAt ?? now,
            updatedAt: now,
          };

          yield* Effect.all([
            rows.oauthStates.upsert(oauthState),
            rows.authMaterials.removeByConnectionId(requestedConnectionId),
          ]).pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.upsert_oauth", error),
            ),
          );
        } else {
          const existingMaterial = materials.find(
            (material) => material.connectionId === requestedConnectionId,
          ) ?? null;

          const material: AuthMaterial = {
            id:
              existingMaterial?.id
              ?? (`auth_material_${crypto.randomUUID()}` as AuthMaterial["id"]),
            connectionId: requestedConnectionId,
            ciphertext: input.payload.secretRef,
            keyVersion: existingMaterial?.keyVersion ?? "local",
            createdAt: existingMaterial?.createdAt ?? now,
            updatedAt: now,
          };

          yield* Effect.all([
            rows.authMaterials.upsert(material),
            rows.oauthStates.removeByConnectionId(requestedConnectionId),
          ]).pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.upsert_secret", error),
            ),
          );
        }

        return toCompatSourceCredentialBinding(nextBinding, nextConnection);
      }),

    removeCredentialBinding: (input) =>
      Effect.gen(function* () {
        const [bindings, workspaces] = yield* Effect.all([
          rows.sourceAuthBindings.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.bindings.list", error),
            ),
          ),
          rows.workspaces.list().pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.workspaces.list", error),
            ),
          ),
        ]);

        const organizationId = resolveWorkspaceOrganizationId(workspaces, input.workspaceId);
        const binding = bindings.find(
          (item) =>
            item.id === input.credentialBindingId
            && (
              item.workspaceId === input.workspaceId
              || (item.workspaceId === null && item.organizationId === organizationId)
            ),
        );

        if (!binding) {
          return {
            removed: false,
          };
        }

        const removed = yield* rows.sourceAuthBindings
          .removeById(binding.id)
          .pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.remove_binding", error),
            ),
          );

        if (!removed) {
          return {
            removed: false,
          };
        }

        const hasRemainingBindings = bindings.some(
          (candidate) =>
            candidate.id !== binding.id && candidate.connectionId === binding.connectionId,
        );

        if (!hasRemainingBindings) {
          yield* Effect.all([
            rows.authConnections.removeById(binding.connectionId),
            rows.authMaterials.removeByConnectionId(binding.connectionId),
            rows.oauthStates.removeByConnectionId(binding.connectionId),
          ]).pipe(
            Effect.mapError((error) =>
              toSourceStoreErrorFromRowStore("credentials.remove_connection_data", error),
            ),
          );
        }

        return {
          removed: true,
        };
      }),
  });
