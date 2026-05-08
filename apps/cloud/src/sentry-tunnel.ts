import { Data, Effect, Schema } from "effect";

export const MAX_SENTRY_ENVELOPE_BODY_BYTES = 200_000;

class SentryTunnelError extends Data.TaggedError("SentryTunnelError")<{
  readonly cause?: unknown;
}> {}

const SentryEnvelopeHeader = Schema.Struct({
  dsn: Schema.optional(Schema.String),
});

const decodeSentryEnvelopeHeader = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SentryEnvelopeHeader),
);

const badSentryEnvelopeResponse = () => new Response("bad envelope", { status: 400 });

const requestContentLength = (request: Request): number | null => {
  const value = request.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const readLimitedRequestText = (request: Request, maxBytes: number) =>
  Effect.gen(function* () {
    const length = requestContentLength(request);
    if (length !== null && length > maxBytes) {
      return yield* new SentryTunnelError({ cause: "payload_too_large" });
    }
    const text = yield* Effect.tryPromise({
      try: () => request.text(),
      catch: (cause) => new SentryTunnelError({ cause }),
    });
    if (text.length > maxBytes) {
      return yield* new SentryTunnelError({ cause: "payload_too_large" });
    }
    return text;
  });

export const handleSentryTunnelRequest = (request: Request, configuredDsn: string) =>
  Effect.gen(function* () {
    const envelope = yield* readLimitedRequestText(request, MAX_SENTRY_ENVELOPE_BODY_BYTES).pipe(
      Effect.catchTag("SentryTunnelError", (error) =>
        error.cause === "payload_too_large"
          ? Effect.succeed(new Response("payload too large", { status: 413 }))
          : Effect.fail(error),
      ),
    );
    if (envelope instanceof Response) return envelope;
    const firstLine = envelope.slice(0, envelope.indexOf("\n"));
    const header = yield* decodeSentryEnvelopeHeader(firstLine).pipe(
      Effect.mapError((cause) => new SentryTunnelError({ cause })),
    );
    const dsn = header.dsn;
    if (!dsn) return new Response("missing dsn", { status: 400 });

    const envelopeDsn = yield* Effect.try({
      try: () => new URL(dsn),
      catch: (cause) => new SentryTunnelError({ cause }),
    });
    const ourDsn = yield* Effect.try({
      try: () => new URL(configuredDsn),
      catch: (cause) => new SentryTunnelError({ cause }),
    });
    if (envelopeDsn.host !== ourDsn.host || envelopeDsn.pathname !== ourDsn.pathname) {
      return new Response("dsn mismatch", { status: 400 });
    }

    const projectId = envelopeDsn.pathname.replace(/^\//, "");
    const ingestUrl = `https://${envelopeDsn.host}/api/${projectId}/envelope/`;
    return yield* Effect.tryPromise({
      try: () =>
        fetch(ingestUrl, {
          method: "POST",
          body: envelope,
          headers: { "Content-Type": "application/x-sentry-envelope" },
        }),
      catch: (cause) => new SentryTunnelError({ cause }),
    });
  }).pipe(Effect.catch(() => Effect.succeed(badSentryEnvelopeResponse())));
