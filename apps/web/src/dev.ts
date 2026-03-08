/**
 * Dev entry point for @hono/vite-dev-server.
 *
 * Exports `{ fetch }` so Vite can forward API requests to the executor
 * control-plane handler. Everything else (frontend assets, HMR) is
 * handled by Vite itself.
 */
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { createLocalExecutorRequestHandler } from "@executor-v3/server";

// Create a long-lived scope that stays open for the lifetime of the process.
const handlerPromise = Effect.runPromise(
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const handler = yield* createLocalExecutorRequestHandler().pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    handler.setBaseUrl("http://127.0.0.1:8788");
    return handler;
  }),
);

export default {
  async fetch(request: Request) {
    const handler = await handlerPromise;
    return handler.handleApiRequest(request);
  },
};
