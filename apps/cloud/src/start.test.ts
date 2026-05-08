import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { handleSentryTunnelRequest, MAX_SENTRY_ENVELOPE_BODY_BYTES } from "./sentry-tunnel";

describe("handleSentryTunnelRequest", () => {
  it.effect("rejects oversized Sentry tunnel envelopes before forwarding", () =>
    Effect.gen(function* () {
      const response = yield* handleSentryTunnelRequest(
        new Request("https://executor.sh/api/sentry-tunnel", {
          method: "POST",
          body: "x".repeat(MAX_SENTRY_ENVELOPE_BODY_BYTES + 1),
        }),
        "https://public@example.sentry.io/123",
      );

      expect(response.status).toBe(413);
      expect(yield* Effect.promise(() => response.text())).toBe("payload too large");
    }),
  );
});
