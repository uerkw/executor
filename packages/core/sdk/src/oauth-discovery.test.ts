import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Cause, Effect, Exit, Schema } from "effect";

import {
  OAuthDiscoveryError,
  beginDynamicAuthorization,
  canonicalResourceUrl,
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  registerDynamicClient,
} from "./oauth-discovery";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

const DcrRequestBody = Schema.Struct({
  redirect_uris: Schema.Array(Schema.String),
  token_endpoint_auth_method: Schema.String,
  scope: Schema.optional(Schema.String),
  client_uri: Schema.optional(Schema.String),
});
const decodeDcrRequestBody = Schema.decodeUnknownSync(Schema.fromJsonString(DcrRequestBody));

const installFetchRouter = (
  handlers: readonly { match: (url: string) => boolean; handle: Handler }[],
): { calls: Array<{ url: string; init: RequestInit }> } => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    for (const h of handlers) {
      if (h.match(url)) return h.handle(url, init);
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls };
};

const originalFetch = globalThis.fetch;

describe("canonicalResourceUrl", () => {
  it("lowercases scheme + host, drops trailing slash, fragment, and query", () => {
    expect(canonicalResourceUrl("https://API.Example.com/v1/mcp/")).toBe(
      "https://api.example.com/v1/mcp",
    );
    expect(canonicalResourceUrl("HTTPS://api.example.com/v1/mcp?x=1#frag")).toBe(
      "https://api.example.com/v1/mcp",
    );
    expect(canonicalResourceUrl("https://api.example.com/")).toBe("https://api.example.com");
  });
});

describe("discoverProtectedResourceMetadata", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches RFC 9728 well-known metadata on the resource's origin", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-protected-resource/graphql",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-protected-resource",
        handle: () =>
          new Response(
            JSON.stringify({
              resource: "https://api.example.com",
              authorization_servers: ["https://api.example.com"],
              scopes_supported: ["read"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      discoverProtectedResourceMetadata("https://api.example.com/graphql"),
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.authorization_servers?.[0]).toBe("https://api.example.com");
    expect(result!.metadataUrl).toBe(
      "https://api.example.com/.well-known/oauth-protected-resource",
    );
  });

  it("returns null when every well-known candidate 404s", async () => {
    installFetchRouter([{ match: () => true, handle: () => new Response(null, { status: 404 }) }]);

    const result = await Effect.runPromise(
      discoverProtectedResourceMetadata("https://api.example.com/graphql"),
    );
    expect(result).toBeNull();
  });

  it("surfaces malformed metadata bodies as OAuthDiscoveryError", async () => {
    installFetchRouter([
      {
        match: () => true,
        handle: () =>
          new Response("not json", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    ]);
    const exit = await Effect.runPromiseExit(
      discoverProtectedResourceMetadata("https://api.example.com"),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const reason = exit.cause.reasons.find(Cause.isFailReason);
    expect(reason?.error).toBeInstanceOf(OAuthDiscoveryError);
  });
});

describe("discoverAuthorizationServerMetadata", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("falls back to openid-configuration when oauth-authorization-server is absent", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://as.example.com/.well-known/oauth-authorization-server",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://as.example.com/.well-known/openid-configuration",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://as.example.com",
              authorization_endpoint: "https://as.example.com/authorize",
              token_endpoint: "https://as.example.com/token",
              code_challenge_methods_supported: ["S256"],
              response_types_supported: ["code"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      discoverAuthorizationServerMetadata("https://as.example.com"),
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.token_endpoint).toBe("https://as.example.com/token");
    expect(result!.metadataUrl.endsWith("openid-configuration")).toBe(true);
  });

  it("requires issuer + authorize + token endpoints", async () => {
    installFetchRouter([
      {
        match: () => true,
        handle: () =>
          new Response(JSON.stringify({ issuer: "https://as" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    ]);
    const exit = await Effect.runPromiseExit(discoverAuthorizationServerMetadata("https://as"));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("registerDynamicClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs RFC 7591 metadata and parses the client information response", async () => {
    const { calls } = installFetchRouter([
      {
        match: (u) => u === "https://as.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "generated-client-id",
              client_id_issued_at: 1_700_000_000,
              redirect_uris: ["https://app.example.com/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const info = await Effect.runPromise(
      registerDynamicClient({
        registrationEndpoint: "https://as.example.com/register",
        metadata: {
          redirect_uris: ["https://app.example.com/cb"],
          client_name: "Executor",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
      }),
    );
    expect(info.client_id).toBe("generated-client-id");

    const call = calls[0]!;
    expect(call.init.method).toBe("POST");
    const body = decodeDcrRequestBody(call.init.body);
    expect(body.redirect_uris).toEqual(["https://app.example.com/cb"]);
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  // Todoist's DCR returns 200 OK with the client information body
  // instead of the RFC 7591-mandated 201 Created. oauth4webapi's
  // `processDynamicClientRegistrationResponse` rejects that as
  // "unexpected HTTP status code"; we accept both.
  it("treats HTTP 200 as success (Todoist-style non-conformance)", async () => {
    installFetchRouter([
      {
        match: () => true,
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "tdd_abc",
              redirect_uris: ["https://app.example.com/cb"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ]);
    const info = await Effect.runPromise(
      registerDynamicClient({
        registrationEndpoint: "https://todoist.com/oauth/register",
        metadata: { redirect_uris: ["https://app.example.com/cb"] },
      }),
    );
    expect(info.client_id).toBe("tdd_abc");
  });

  it("surfaces AS error responses with the error body", async () => {
    installFetchRouter([
      {
        match: () => true,
        handle: () =>
          new Response(
            JSON.stringify({
              error: "invalid_client_metadata",
              error_description: "redirect_uris must be https",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      },
    ]);
    const exit = await Effect.runPromiseExit(
      registerDynamicClient({
        registrationEndpoint: "https://as/register",
        metadata: { redirect_uris: ["http://localhost/cb"] },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const reason = exit.cause.reasons.find(Cause.isFailReason);
    const error = reason?.error;
    expect(error).toEqual(
      expect.objectContaining({
        _tag: "OAuthDiscoveryError",
        status: 400,
        message: expect.stringMatching(/invalid_client_metadata/),
      }),
    );
  });
});

describe("beginDynamicAuthorization", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // The shape Railway's backboard publishes — this locks in the
  // end-to-end flow for the concrete case that motivated the feature.
  const installRailwayLike = (): void => {
    installFetchRouter([
      {
        match: (u) =>
          u === "https://backboard.railway.com/.well-known/oauth-protected-resource/graphql/v2",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://backboard.railway.com/.well-known/oauth-protected-resource",
        handle: () =>
          new Response(
            JSON.stringify({
              resource: "https://backboard.railway.com",
              authorization_servers: ["https://backboard.railway.com"],
              scopes_supported: [
                "openid",
                "profile",
                "email",
                "offline_access",
                "workspace:member",
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://backboard.railway.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://backboard.railway.com",
              authorization_endpoint: "https://backboard.railway.com/oauth/auth",
              token_endpoint: "https://backboard.railway.com/oauth/token",
              registration_endpoint: "https://backboard.railway.com/oauth/register",
              scopes_supported: [
                "openid",
                "profile",
                "email",
                "offline_access",
                "workspace:member",
              ],
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://backboard.railway.com/oauth/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "dyn-client-42",
              redirect_uris: ["https://app.example/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);
  };

  it("runs the full discovery + DCR + PKCE chain for a Railway-shaped endpoint", async () => {
    installRailwayLike();

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://backboard.railway.com/graphql/v2",
        redirectUrl: "https://app.example/cb",
        state: "state-xyz",
      }),
    );

    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://backboard.railway.com/oauth/auth");
    expect(url.searchParams.get("client_id")).toBe("dyn-client-42");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(result.state.authorizationServerUrl).toBe("https://backboard.railway.com");
    expect(result.state.authorizationServerMetadata.token_endpoint).toBe(
      "https://backboard.railway.com/oauth/token",
    );
    expect(result.state.clientInformation.client_id).toBe("dyn-client-42");
    expect(result.state.resourceMetadata?.resource).toBe("https://backboard.railway.com");
  });

  it("declares requested scopes in the DCR body when caller passes them explicitly", async () => {
    const { calls } = installFetchRouter([
      {
        match: (u) => u === "https://mcp.grata.com/.well-known/oauth-protected-resource",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://mcp.grata.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://mcp.grata.com/",
              authorization_endpoint: "https://mcp.grata.com/authorize",
              token_endpoint: "https://mcp.grata.com/token",
              registration_endpoint: "https://mcp.grata.com/register",
              scopes_supported: ["openid", "profile", "email", "offline_access"],
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://mcp.grata.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "grata-client-id",
              redirect_uris: ["https://app.example/cb"],
              token_endpoint_auth_method: "none",
              scope: "openid offline_access",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://mcp.grata.com/",
        redirectUrl: "https://app.example/cb",
        state: "state-grata",
        scopes: ["openid", "offline_access"],
      }),
    );

    const dcrCall = calls.find((c) => c.url === "https://mcp.grata.com/register");
    expect(dcrCall).toBeDefined();
    const body = decodeDcrRequestBody(String(dcrCall!.init.body));
    expect(body.scope).toBe("openid offline_access");

    const authUrl = new URL(result.authorizationUrl);
    expect(authUrl.searchParams.get("scope")).toBe("openid offline_access");
    expect(authUrl.searchParams.get("client_id")).toBe("grata-client-id");
  });

  it("requests only PRM scopes_supported when advertised (RFC 9728 §2 limited scope)", async () => {
    const { calls } = installFetchRouter([
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-protected-resource/v1/mcp",
        handle: () =>
          new Response(
            JSON.stringify({
              resource: "https://api.example.com/v1/mcp",
              authorization_servers: ["https://as.example.com"],
              scopes_supported: ["mcp:read"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://as.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://as.example.com",
              authorization_endpoint: "https://as.example.com/authorize",
              token_endpoint: "https://as.example.com/token",
              registration_endpoint: "https://as.example.com/register",
              scopes_supported: ["openid", "profile", "mcp:read", "mcp:admin", "offline_access"],
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://as.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "narrow-scope-client",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://api.example.com/v1/mcp",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    const dcrCall = calls.find((c) => c.url === "https://as.example.com/register");
    const body = decodeDcrRequestBody(String(dcrCall!.init.body));
    expect(body.scope).toBe("mcp:read");

    const authUrl = new URL(result.authorizationUrl);
    expect(authUrl.searchParams.get("scope")).toBe("mcp:read");
  });

  it("requests empty scope when only AS-level scopes_supported is advertised (RFC 9728 §2)", async () => {
    const { calls } = installFetchRouter([
      {
        match: (u) => u === "https://only-as.example.com/.well-known/oauth-protected-resource",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://only-as.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://only-as.example.com",
              authorization_endpoint: "https://only-as.example.com/authorize",
              token_endpoint: "https://only-as.example.com/token",
              registration_endpoint: "https://only-as.example.com/register",
              scopes_supported: ["openid", "profile", "admin", "offline_access"],
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://only-as.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "no-scope-client",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://only-as.example.com/",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    const dcrCall = calls.find((c) => c.url === "https://only-as.example.com/register");
    const body = decodeDcrRequestBody(String(dcrCall!.init.body));
    expect(body.scope).toBeUndefined();

    const authUrl = new URL(result.authorizationUrl);
    expect(authUrl.searchParams.get("scope")).toBe("");
  });

  it("includes RFC 8707 resource parameter on the authorization URL (PRM resource claim)", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-protected-resource/v1/mcp",
        handle: () =>
          new Response(
            JSON.stringify({
              resource: "https://api.example.com/canonical-id",
              authorization_servers: ["https://api.example.com"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://api.example.com",
              authorization_endpoint: "https://api.example.com/authorize",
              token_endpoint: "https://api.example.com/token",
              registration_endpoint: "https://api.example.com/register",
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://api.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "res-client",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://api.example.com/v1/mcp",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    const authUrl = new URL(result.authorizationUrl);
    expect(authUrl.searchParams.get("resource")).toBe("https://api.example.com/canonical-id");
    expect(result.state.resource).toBe("https://api.example.com/canonical-id");
  });

  it("falls back to canonical endpoint URL for the resource parameter when PRM is absent", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-protected-resource/v1/mcp",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-protected-resource",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://api.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://api.example.com",
              authorization_endpoint: "https://api.example.com/authorize",
              token_endpoint: "https://api.example.com/token",
              registration_endpoint: "https://api.example.com/register",
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://api.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "ep-client",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://API.example.com/v1/mcp/",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    const authUrl = new URL(result.authorizationUrl);
    expect(authUrl.searchParams.get("resource")).toBe("https://api.example.com/v1/mcp");
  });

  it("includes client_uri in the DCR body (RFC 7591 §2 RECOMMENDED)", async () => {
    const { calls } = installFetchRouter([
      {
        match: (u) => u === "https://only-as.example.com/.well-known/oauth-protected-resource",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://only-as.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://only-as.example.com",
              authorization_endpoint: "https://only-as.example.com/authorize",
              token_endpoint: "https://only-as.example.com/token",
              registration_endpoint: "https://only-as.example.com/register",
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://only-as.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "uri-client",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://only-as.example.com/",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    const dcrCall = calls.find((c) => c.url === "https://only-as.example.com/register");
    const body = decodeDcrRequestBody(String(dcrCall!.init.body));
    expect(body.client_uri).toBe("https://executor.sh");
  });

  it("negotiates client_secret_post when the AS does not advertise 'none' (Clay-style)", async () => {
    const { calls } = installFetchRouter([
      {
        match: (u) => u === "https://api.clay.com/.well-known/oauth-protected-resource/v3/mcp",
        handle: () =>
          new Response(
            JSON.stringify({
              resource: "https://api.clay.com/v3/mcp",
              authorization_servers: ["https://api.clay.com"],
              scopes_supported: ["mcp"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://api.clay.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://api.clay.com",
              authorization_endpoint: "https://api.clay.com/authorize",
              token_endpoint: "https://api.clay.com/token",
              registration_endpoint: "https://api.clay.com/register",
              token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://api.clay.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "clay-id",
              client_secret: "clay-secret",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "client_secret_post",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://api.clay.com/v3/mcp",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    const dcrCall = calls.find((c) => c.url === "https://api.clay.com/register");
    const body = decodeDcrRequestBody(String(dcrCall!.init.body));
    expect(body.token_endpoint_auth_method).toBe("client_secret_post");
  });

  it("fails with a clear error when the AS advertises only auth methods we don't support", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://jwt-only.example.com/.well-known/oauth-protected-resource",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://jwt-only.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://jwt-only.example.com",
              authorization_endpoint: "https://jwt-only.example.com/authorize",
              token_endpoint: "https://jwt-only.example.com/token",
              registration_endpoint: "https://jwt-only.example.com/register",
              token_endpoint_auth_methods_supported: ["private_key_jwt"],
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const exit = await Effect.runPromiseExit(
      beginDynamicAuthorization({
        endpoint: "https://jwt-only.example.com/",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const reason = exit.cause.reasons.find(Cause.isFailReason);
    expect(reason?.error).toEqual(
      expect.objectContaining({
        _tag: "OAuthDiscoveryError",
        message: expect.stringMatching(/usable token_endpoint_auth_method/),
      }),
    );
  });

  it("falls through to a later authorization_servers entry when the first has no metadata", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://multi-as.example.com/.well-known/oauth-protected-resource/api",
        handle: () =>
          new Response(
            JSON.stringify({
              resource: "https://multi-as.example.com/api",
              authorization_servers: ["https://primary.example.com", "https://backup.example.com"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://primary.example.com/.well-known/oauth-authorization-server",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://primary.example.com/.well-known/openid-configuration",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://backup.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://backup.example.com",
              authorization_endpoint: "https://backup.example.com/authorize",
              token_endpoint: "https://backup.example.com/token",
              registration_endpoint: "https://backup.example.com/register",
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://backup.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              client_id: "backup-client",
              redirect_uris: ["https://app/cb"],
              token_endpoint_auth_method: "none",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://multi-as.example.com/api",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );

    expect(result.state.authorizationServerUrl).toBe("https://backup.example.com");
    expect(result.state.clientInformation.client_id).toBe("backup-client");
  });

  it("propagates AS error code + description on DCR failure (RFC 7591 §3.2.2)", async () => {
    installFetchRouter([
      {
        match: (u) => u === "https://errd.example.com/.well-known/oauth-protected-resource",
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u === "https://errd.example.com/.well-known/oauth-authorization-server",
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://errd.example.com",
              authorization_endpoint: "https://errd.example.com/authorize",
              token_endpoint: "https://errd.example.com/token",
              registration_endpoint: "https://errd.example.com/register",
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
      {
        match: (u) => u === "https://errd.example.com/register",
        handle: () =>
          new Response(
            JSON.stringify({
              error: "invalid_redirect_uri",
              error_description: "redirect_uri must be from an allowed domain",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      },
    ]);

    const exit = await Effect.runPromiseExit(
      beginDynamicAuthorization({
        endpoint: "https://errd.example.com/",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const reason = exit.cause.reasons.find(Cause.isFailReason);
    expect(reason?.error).toEqual(
      expect.objectContaining({
        _tag: "OAuthDiscoveryError",
        status: 400,
        error: "invalid_redirect_uri",
        errorDescription: "redirect_uri must be from an allowed domain",
      }),
    );
  });

  it("skips discovery + DCR when previousState is provided", async () => {
    const { calls } = installFetchRouter([]);

    const result = await Effect.runPromise(
      beginDynamicAuthorization({
        endpoint: "https://as.example.com/graphql",
        redirectUrl: "https://app/cb",
        state: "s",
        previousState: {
          authorizationServerUrl: "https://as.example.com",
          authorizationServerMetadataUrl:
            "https://as.example.com/.well-known/oauth-authorization-server",
          authorizationServerMetadata: {
            issuer: "https://as.example.com",
            authorization_endpoint: "https://as.example.com/authorize",
            token_endpoint: "https://as.example.com/token",
            code_challenge_methods_supported: ["S256"],
            response_types_supported: ["code"],
          },
          clientInformation: {
            client_id: "stored-client",
          },
        },
      }),
    );

    expect(calls.length).toBe(0);
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe("stored-client");
  });

  it("rejects servers that don't support PKCE S256", async () => {
    installFetchRouter([
      {
        match: (u) => u.endsWith("oauth-protected-resource"),
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u.endsWith("oauth-authorization-server"),
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://legacy.example.com",
              authorization_endpoint: "https://legacy.example.com/authorize",
              token_endpoint: "https://legacy.example.com/token",
              code_challenge_methods_supported: ["plain"],
              response_types_supported: ["code"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ]);
    const exit = await Effect.runPromiseExit(
      beginDynamicAuthorization({
        endpoint: "https://legacy.example.com/api",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("fails when the authorization server has no registration_endpoint and no previous client", async () => {
    installFetchRouter([
      {
        match: (u) => u.endsWith("oauth-protected-resource"),
        handle: () => new Response(null, { status: 404 }),
      },
      {
        match: (u) => u.endsWith("oauth-authorization-server"),
        handle: () =>
          new Response(
            JSON.stringify({
              issuer: "https://static.example.com",
              authorization_endpoint: "https://static.example.com/authorize",
              token_endpoint: "https://static.example.com/token",
              code_challenge_methods_supported: ["S256"],
              response_types_supported: ["code"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ]);
    const exit = await Effect.runPromiseExit(
      beginDynamicAuthorization({
        endpoint: "https://static.example.com/api",
        redirectUrl: "https://app/cb",
        state: "s",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
