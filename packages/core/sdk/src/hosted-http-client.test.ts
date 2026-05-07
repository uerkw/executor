import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  HostedOutboundRequestBlocked,
  makeHostedHttpClientLayer,
  validateHostedOutboundUrl,
} from "./hosted-http-client";

describe("hosted outbound HTTP client", () => {
  it.effect("allows public HTTP and HTTPS URLs", () =>
    Effect.gen(function* () {
      yield* validateHostedOutboundUrl("https://example.com/openapi.json");
      yield* validateHostedOutboundUrl("http://example.com/graphql");
    }),
  );

  it.effect("rejects local and private network URLs", () =>
    Effect.gen(function* () {
      for (const url of [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://10.0.0.1/openapi.json",
        "http://172.16.0.1/graphql",
        "http://192.168.1.10/mcp",
        "http://169.254.169.254/latest/meta-data/",
      ]) {
        const error = yield* validateHostedOutboundUrl(url).pipe(Effect.flip);
        expect(error).toBeInstanceOf(HostedOutboundRequestBlocked);
      }
    }),
  );

  it.effect("can allow local network URLs explicitly", () =>
    Effect.gen(function* () {
      yield* validateHostedOutboundUrl("http://127.0.0.1:3000", {
        allowLocalNetwork: true,
      });
    }),
  );

  it.effect("checks redirected URLs before following them", () =>
    Effect.gen(function* () {
      let calls = 0;
      const fakeFetch: typeof globalThis.fetch = (async (input) => {
        calls++;
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://public.example/start") {
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1:3000/internal" },
          });
        }
        return new Response("unexpected", { status: 200 });
      }) as typeof globalThis.fetch;
      const result = yield* Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return yield* client.execute(HttpClientRequest.get("https://public.example/start"));
      }).pipe(Effect.provide(makeHostedHttpClientLayer({ fetch: fakeFetch })), Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(calls).toBe(1);
    }),
  );
});
