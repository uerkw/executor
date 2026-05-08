import { env } from "cloudflare:workers";
import { Cause, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { SlackService } from "../services/slack";
import { HttpResponseError, isServerError, toErrorServerResponse } from "./error-response";

const isValidEmail = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

const rateLimitKey = (request: Request, email: string): string => {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
    "unknown";
  return `${ip}:${email.toLowerCase()}`;
};

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);

  if (request.method !== "POST") {
    return yield* new HttpResponseError({
      status: 405,
      code: "method_not_allowed",
      message: "Method not allowed",
    });
  }

  const body = (yield* Effect.mapError(
    request.json,
    () =>
      new HttpResponseError({
        status: 400,
        code: "invalid_json",
        message: "Invalid request body",
      }),
  )) as {
    email?: unknown;
    organization?: unknown;
  };

  const trimmed = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const organization = trimmed(body.organization, 200);

  if (!isValidEmail(email)) {
    return yield* new HttpResponseError({
      status: 400,
      code: "invalid_email",
      message: "A valid email is required",
    });
  }

  const limit = yield* Effect.tryPromise({
    try: () => env.SLACK_INVITE_LIMITER.limit({ key: rateLimitKey(webRequest, email) }),
    catch: (cause) => ({ success: false as const, fetchError: cause }),
  });
  if (!limit.success) {
    console.error("[slack] global rate limit hit");
    return yield* new HttpResponseError({
      status: 429,
      code: "rate_limited",
      message: "We're getting more contact requests than usual. Please try again later.",
    });
  }

  const slack = yield* SlackService;
  const { invite } = yield* slack.createConnectInvite({ email, organization }).pipe(
    Effect.tapError((err) =>
      Effect.sync(() => {
        console.error(`[slack] ${err.method} failed:`, err.error);
      }),
    ),
    Effect.mapError(
      () =>
        new HttpResponseError({
          status: 500,
          code: "slack_invite_failed",
          message: "Couldn't create your Slack invite. Please try again shortly.",
        }),
    ),
  );

  return HttpServerResponse.jsonUnsafe({ url: invite.url }, { status: 200 });
}).pipe(
  Effect.catchCause((err) => {
    if (isServerError(err)) {
      console.error("[slack] request failed:", Cause.pretty(err));
    }
    return Effect.succeed(toErrorServerResponse(err));
  }),
);

export const SlackContactRoutesLive = HttpRouter.add("POST", "/contact/slack", handler);
