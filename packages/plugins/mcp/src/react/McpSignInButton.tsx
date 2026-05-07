import { useCallback } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { ConnectionId, ScopeId } from "@executor-js/sdk/core";
import { useScope, useUserScope } from "@executor-js/react/api/scope-context";
import { connectionWriteKeys, sourceWriteKeys } from "@executor-js/react/api/reactivity-keys";
import { connectionsAtom } from "@executor-js/react/api/atoms";
import {
  OAuthSignInButton,
  oauthCallbackUrl,
  oauthConnectionId,
  useOAuthPopupFlow,
  type OAuthCompletionPayload,
} from "@executor-js/react/plugins/oauth-sign-in";
import { slugifyNamespace } from "@executor-js/react/plugins/source-identity";

import { mcpSourceAtom, mcpSourceBindingsAtom, setMcpSourceBinding } from "./atoms";
import type { McpStoredSourceSchemaType } from "../sdk/stored-source";
import type {
  ConfiguredMcpCredentialValue,
  McpSourceBindingRef,
  SecretBackedValue,
} from "../sdk/types";

const valuesForOAuth = (
  values: Record<string, ConfiguredMcpCredentialValue> | undefined,
  bindings: readonly McpSourceBindingRef[],
): Record<string, SecretBackedValue> | undefined => {
  const bySlot = new Map(bindings.map((binding) => [binding.slot, binding]));
  const out: Record<string, SecretBackedValue> = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    if (typeof value === "string") {
      out[name] = value;
      continue;
    }
    const binding = bySlot.get(value.slot);
    if (binding?.value.kind === "secret") {
      out[name] = value.prefix
        ? { secretId: binding.value.secretId, prefix: value.prefix }
        : { secretId: binding.value.secretId };
    } else if (binding?.value.kind === "text") {
      out[name] = binding.value.text;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

// ---------------------------------------------------------------------------
// McpSignInButton — top-bar action on the source detail page.
//
// Reads the source's stored endpoint + oauth2 slot, re-runs the DCR /
// authorization-code flow against a stable `mcp-oauth2-${namespace}`
// connection id, and on success writes the user's credential binding.
// ---------------------------------------------------------------------------

export default function McpSignInButton(props: { sourceId: string }) {
  const scopeId = useScope();
  const userScopeId = useUserScope();
  const sourceResult = useAtomValue(
    mcpSourceAtom(scopeId, props.sourceId),
  ) as AsyncResult.AsyncResult<McpStoredSourceSchemaType | null, unknown>;
  const source =
    AsyncResult.isSuccess(sourceResult) && sourceResult.value ? sourceResult.value : null;
  const sourceScope = source ? ScopeId.make(source.scope) : scopeId;
  const bindingsResult = useAtomValue(mcpSourceBindingsAtom(scopeId, props.sourceId, sourceScope));
  const connectionsResult = useAtomValue(connectionsAtom(scopeId));
  const setBinding = useAtomSet(setMcpSourceBinding, { mode: "promise" });
  const oauth = useOAuthPopupFlow({
    popupName: "mcp-oauth",
  });

  const remote = source && source.config.transport === "remote" ? source.config : null;
  const oauth2 = remote && remote.auth.kind === "oauth2" ? remote.auth : null;
  const connections = AsyncResult.isSuccess(connectionsResult)
    ? (connectionsResult.value as readonly { readonly id: string }[])
    : null;
  const bindings = AsyncResult.isSuccess(bindingsResult) ? bindingsResult.value : null;
  const connectionBinding = bindings?.find(
    (binding) => binding.slot === oauth2?.connectionSlot && binding.value.kind === "connection",
  );
  const connectionId =
    connectionBinding?.value.kind === "connection" ? connectionBinding.value.connectionId : null;
  const isConnected =
    oauth2 !== null &&
    connections !== null &&
    connectionId !== null &&
    connections.some((c) => c.id === connectionId);

  const handleSignIn = useCallback(async () => {
    if (!remote || !oauth2 || !source) return;
    const namespaceSlug = slugifyNamespace(source.namespace) || "mcp";
    await oauth.start({
      payload: {
        endpoint: remote.endpoint,
        redirectUrl: oauthCallbackUrl(),
        connectionId: oauthConnectionId({
          pluginId: "mcp",
          namespace: namespaceSlug,
        }),
        headers: valuesForOAuth(remote.headers, bindings ?? []),
        queryParams: valuesForOAuth(remote.queryParams, bindings ?? []),
        tokenScope: userScopeId,
        strategy: { kind: "dynamic-dcr" },
        pluginId: "mcp",
        identityLabel: `${source.name.trim() || source.namespace || "MCP"} OAuth`,
      },
      onSuccess: async (result: OAuthCompletionPayload) => {
        await setBinding({
          params: { scopeId },
          payload: {
            sourceId: props.sourceId,
            sourceScope,
            scope: userScopeId,
            slot: oauth2.connectionSlot,
            value: { kind: "connection", connectionId: ConnectionId.make(result.connectionId) },
          },
          reactivityKeys: [...sourceWriteKeys, ...connectionWriteKeys],
        });
      },
    });
  }, [
    remote,
    oauth2,
    source,
    bindings,
    scopeId,
    props.sourceId,
    sourceScope,
    setBinding,
    oauth,
    userScopeId,
  ]);

  if (!oauth2) return null;

  return (
    <OAuthSignInButton
      busy={oauth.busy}
      error={oauth.error}
      isConnected={isConnected}
      onSignIn={() => void handleSignIn()}
      reconnectingLabel="Reconnecting…"
      signingInLabel="Signing in…"
    />
  );
}
