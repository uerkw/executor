## Highlights

### Unified credential bindings

Source credentials (OAuth tokens, header secrets, client-credential pairs) are now stored as **scoped credential bindings** instead of plugin-specific shapes. Two consequences for users:

- One consistent UI for editing credentials across OpenAPI, MCP, and GraphQL sources. The old per-plugin credential forms are gone, replaced with a shared slot UI in `@executor-js/react` (`credential-bindings`, `credential-slot-bindings`, `oauth-sign-in`).
- Existing OpenAPI / MCP / GraphQL / google-discovery credentials are migrated into the new binding rows automatically on first launch (drizzle migrations `0007`, `0008`, `0010` for `apps/local`). No user action required.

### See where a secret or connection is used

A new `executor.usages` surface lets plugins declare every place they reference a secret or connection. The local UI uses it to:

- Show a "used in N sources / M bindings" summary on the secret detail page.
- Surface a clear "this secret is in use, remove the references first" toast (backed by the new `SecretInUseError` / `ConnectionInUseError`) instead of letting the delete fail silently.

Plugin authors implement `usagesForSecret` / `usagesForConnection`; the executor fans out and concatenates.

### MCP source detection works on more servers

Adding an MCP source now succeeds against servers that previously failed to probe.

- Bearer-auth MCP servers are detected on the initial probe instead of being misclassified as plain HTTP. Probe error messages also tell you what shape of auth challenge came back.
- 401 challenges that advertise `resource_metadata=` are recognized as MCP-spec OAuth signals.
- Probes accept RFC 6750-compliant body forms for the access-token check, so servers that don't honor the `Authorization` header on the probe path still discover correctly.
- A live-snapshot regression suite covers 29 real public MCP servers; new probes are checked against those snapshots before shipping.
- The MCP connection pool now keys by source identity, so two MCP sources pointing at the same upstream URL with different credentials no longer collide on one shared connection.

### TypeScript code runs in dynamic-worker and QuickJS runtimes

Both runtimes strip TypeScript syntax before evaluation, so tools that pass TS source (annotations, `as` casts, type aliases, etc.) execute without a separate compile step. Previously you had to hand-strip types or precompile.

### OpenAPI source UX

- Source-add screens reworked: cleaner flow, the freeform combobox lists the URL you typed first, scoped credential UI clarified.
- OpenAPI import size limit removed — large specs (Stripe, GitHub, etc.) import without truncation.
- The OpenAPI source edit page lets you change the OAuth2 token / authorization endpoint URLs without removing and re-adding the source.
- Source favicons render again on the sources list (regression from the source-credential cutover).
- `listSourceBindings` no longer 500s when called after a source has been removed.

### OAuth reliability

A pile of small fixes to the OAuth flow, individually unspectacular, collectively meaning fewer mysterious "Sign in" failures:

- DCR registration declares the requested scopes in the body so providers that key on body-scope (rather than `scope=` on the auth URL) issue refresh tokens with the right grants.
- Refresh requests use the exact scopes from the original token grant; servers that reject scope upgrades on refresh stop returning `invalid_scope`.
- `id_token` values returned alongside an access token are stripped before validation (some providers send malformed JWTs in this slot, which used to fail the whole exchange).
- The `scope` parameter is omitted entirely when empty, instead of being sent as `scope=`.
- OAuth endpoint URLs from discovery / DCR are validated; obviously-broken metadata fails fast with a clear message rather than later in the popup. Exposed as `assertSupportedOAuthEndpointUrl` / `isSupportedOAuthEndpointUrl` for plugin use.
- Token-endpoint failures now include the upstream HTTP status + body summary in the surfaced error.
- Popup handling: the popup is reserved before the start request fires, and close events are detected reliably, so cancelling sign-in no longer leaves the UI stuck waiting.

### Source-registration tools require approval

Tools that register new sources (e.g. `addSource` on the OpenAPI plugin) now go through the standard approval gate by default, the same way destructive tools do. Safer to point an agent at a workspace that has source-mutating tools available.

### Migration safety for older CLI builds

If an older `executor` build opens a data directory that has been migrated by a newer build, you now get an explicit "this data directory was created by a newer version" error instead of a low-level SQLite schema mismatch crash. Drizzle migration preflight checks were also tightened so partially-applied migrations are caught earlier.

### SDK additions

For plugin authors and embedders:

- `Usage`, `UsagesForSecretInput`, `UsagesForConnectionInput` — the usages contract.
- `CredentialBindingKind`, `CredentialBindingValue`, `ConfiguredCredentialBinding`, `ConfiguredCredentialValue`, `ScopedSecretCredentialInput`, `CredentialBindingRef`, `SetCredentialBindingInput`, `RemoveCredentialBindingInput`, `ReplaceCredentialBindingsInput`, `ResolvedCredentialSlot`, `CredentialBindingId` — the new credential bindings surface.
- `SecretInUseError`, `ConnectionInUseError` — typed errors for blocked deletes.
- `RefreshSourceInput`, `RemoveSourceInput`, `RemoveSecretInput`, `RemoveToolPolicyInput`, `CredentialBindingRow` — new typed inputs / row types.
- `ScopedDBAdapter`, `ScopedTypedAdapter` — type exports for scope-aware storage adapters.
- Plugin `clientConfig` is threaded through `vite-plugin` into the client bundle, so plugins can hand SDK-side config to their React surface without a separate config endpoint.
- Schema compile perf: a new lint rule + hoisted `Schema` compilers keep parse-paths fast.

## Fixes

- `executeWithPause` now settles correctly when the running fiber fails — previously a fiber failure could leave the execution hanging instead of surfacing the error. (#523)
- `isDevMode` correctly identifies the compiled bun binary, so installed CLI builds no longer misdetect themselves as running from source. Thanks @grfwings (#699)
- Drizzle migration handling parses migration metadata with a typed schema and reports outdated-client failures cleanly. Thanks @grfwings (#741)
- Frontend errors and API-client decode failures are now reported through the existing error-reporting path instead of being swallowed silently.
- Source forms keep local error messages on screen instead of clearing them on the next render.
- "Remove in-use source" surfaces a toast instead of a silent failure. (#530)

## Breaking changes

### SDK: `makeTestConfig` import path moved

The deep import path moved from `@executor-js/core/sdk/testing` to `@executor-js/core/sdk/test-config`. The package-root re-export is unchanged:

```ts
// still works
import { makeTestConfig } from "@executor-js/core/sdk";
```

### SDK: per-plugin credential shapes replaced by credential bindings

If you authored a plugin that stored OAuth tokens or other credentials directly under a plugin-specific column, migrate to the unified `CredentialBinding*` surface. The in-tree plugins (OpenAPI, MCP, GraphQL, google-discovery) have all been ported — see them for reference. End users of the CLI / web UI are unaffected; existing rows migrate automatically.
