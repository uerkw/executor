import * as Sentry from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";
import { instrument, type ResolveConfigFn } from "@microlabs/otel-cf-workers";

// ---------------------------------------------------------------------------
// DO export
// ---------------------------------------------------------------------------
// Telemetry for the DO is handled from inside the DO via a self-contained
// WebSdk layer (see `services/telemetry.ts#DoTelemetryLive`). We deliberately
// do NOT wrap the DO class with `instrumentDO` from `otel-cf-workers` — it
// breaks `this` binding on `WorkerTransport`'s streaming primitives and the
// whole MCP session 500s with "Illegal invocation" DOMExceptions.
//
// Sentry's DO wrapper has the same failure mode in our setup, so DO errors
// are captured manually via `Sentry.captureException` inside the DO's catch
// blocks rather than by class wrapping.
// ---------------------------------------------------------------------------

export { McpSessionDO } from "./mcp-session";

// ---------------------------------------------------------------------------
// OTEL config for the main fetch handler — `otel-cf-workers` owns the global
// TracerProvider and flushes via `ctx.waitUntil` at the end of each request.
// ---------------------------------------------------------------------------

type OtelEnv = {
  AXIOM_TOKEN?: string;
  AXIOM_DATASET?: string;
};

const resolveOtelConfig: ResolveConfigFn<OtelEnv> = (env) => ({
  service: { name: "executor-cloud", version: "1.0.0" },
  exporter: {
    url: "https://api.axiom.co/v1/traces",
    headers: {
      Authorization: `Bearer ${env.AXIOM_TOKEN ?? ""}`,
      "X-Axiom-Dataset": env.AXIOM_DATASET ?? "executor-cloud",
    },
  },
});

const instrumentedHandler = instrument({ fetch: handler.fetch }, resolveOtelConfig);

export default Sentry.withSentry(
  (env: Record<string, string>) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0,
    enableLogs: true,
    sendDefaultPii: true,
    // otel-cf-workers owns the global TracerProvider. Sentry's OTEL compat
    // shim registers a ProxyTracerProvider of its own, which prevents
    // otel-cf-workers from finding its WorkerTracer and breaks the whole
    // request path with "global tracer is not of type WorkerTracer".
    skipOpenTelemetrySetup: true,
  }),
  instrumentedHandler,
);
