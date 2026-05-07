import { useCallback } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { connectionsAtom } from "@executor-js/react/api/atoms";
import { useScope, useUserScope } from "@executor-js/react/api/scope-context";
import { connectionWriteKeys, sourceWriteKeys } from "@executor-js/react/api/reactivity-keys";
import {
  OAuthSignInButton,
  oauthCallbackUrl,
  oauthConnectionId,
  useOAuthPopupFlow,
  type OAuthCompletionPayload,
} from "@executor-js/react/plugins/oauth-sign-in";
import { slugifyNamespace } from "@executor-js/react/plugins/source-identity";
import { ConnectionId, ScopeId } from "@executor-js/sdk/core";

import { graphqlSourceAtom, graphqlSourceBindingsAtom, setGraphqlSourceBinding } from "./atoms";
import type {
  ConfiguredGraphqlCredentialValue,
  GraphqlSourceBindingRef,
  HeaderValue,
} from "../sdk/types";

const valuesForOAuth = (
  values: Record<string, ConfiguredGraphqlCredentialValue>,
  bindings: readonly GraphqlSourceBindingRef[],
): Record<string, HeaderValue> | undefined => {
  const bySlot = new Map(bindings.map((binding) => [binding.slot, binding]));
  const out: Record<string, HeaderValue> = {};
  for (const [name, value] of Object.entries(values)) {
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

export default function GraphqlSignInButton(props: { sourceId: string }) {
  const scopeId = useScope();
  const userScopeId = useUserScope();
  const sourceResult = useAtomValue(graphqlSourceAtom(scopeId, props.sourceId));
  const source =
    AsyncResult.isSuccess(sourceResult) && sourceResult.value ? sourceResult.value : null;
  const sourceScope = source ? ScopeId.make(source.scope) : scopeId;
  const bindingsResult = useAtomValue(
    graphqlSourceBindingsAtom(scopeId, props.sourceId, sourceScope),
  );
  const connectionsResult = useAtomValue(connectionsAtom(scopeId));
  const setBinding = useAtomSet(setGraphqlSourceBinding, { mode: "promise" });
  const oauth = useOAuthPopupFlow({
    popupName: "graphql-oauth",
  });

  const oauth2 = source?.auth.kind === "oauth2" ? source.auth : null;
  const bindings = AsyncResult.isSuccess(bindingsResult) ? bindingsResult.value : null;
  const connectionBinding = bindings?.find(
    (binding) => oauth2 !== null && binding.slot === oauth2.connectionSlot,
  );
  const boundConnectionId =
    connectionBinding?.value.kind === "connection" ? connectionBinding.value.connectionId : null;
  const connections = AsyncResult.isSuccess(connectionsResult) ? connectionsResult.value : null;
  const isConnected =
    boundConnectionId !== null &&
    connections !== null &&
    connections.some((c: { readonly id: string }) => c.id === boundConnectionId);

  const handleSignIn = useCallback(async () => {
    if (!source || !oauth2) return;
    const namespaceSlug = slugifyNamespace(source.namespace) || "graphql";
    await oauth.start({
      payload: {
        endpoint: source.endpoint,
        redirectUrl: oauthCallbackUrl(),
        connectionId: oauthConnectionId({
          pluginId: "graphql",
          namespace: namespaceSlug,
        }),
        headers: valuesForOAuth(source.headers, bindings ?? []),
        queryParams: valuesForOAuth(source.queryParams, bindings ?? []),
        tokenScope: userScopeId,
        strategy: { kind: "dynamic-dcr" },
        pluginId: "graphql",
        identityLabel: `${source.name.trim() || source.namespace || "GraphQL"} OAuth`,
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
    source,
    oauth2,
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
    />
  );
}
