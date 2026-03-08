import { access, mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { HttpApiBuilder, HttpServer } from "@effect/platform";
import {
  createControlPlaneApiLayer,
  createSqlControlPlaneRuntime,
  type ResolveExecutionEnvironment,
  type ResolveSecretMaterial,
  type SqlControlPlaneRuntime,
} from "@executor-v3/control-plane";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import {
  DEFAULT_LOCAL_DATA_DIR,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from "./config";

export {
  DEFAULT_LOCAL_DATA_DIR,
  DEFAULT_SERVER_BASE_URL,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  SERVER_POLL_INTERVAL_MS,
  SERVER_START_TIMEOUT_MS,
} from "./config";

type StaticUiOptions = {
  readonly assetsDir?: string;
  readonly devServerUrl?: string;
};

export type LocalExecutorServer = {
  readonly runtime: SqlControlPlaneRuntime;
  readonly port: number;
  readonly host: string;
  readonly baseUrl: string;
};

export type StartLocalExecutorServerOptions = {
  readonly port?: number;
  readonly host?: string;
  readonly localDataDir?: string;
  readonly executionResolver?: ResolveExecutionEnvironment;
  readonly resolveSecretMaterial?: ResolveSecretMaterial;
  readonly ui?: StaticUiOptions;
};

export type LocalExecutorRequestHandler = {
  readonly runtime: SqlControlPlaneRuntime;
  readonly handleApiRequest: (request: Request) => Promise<Response>;
  readonly getBaseUrl: () => string | undefined;
  readonly setBaseUrl: (baseUrl: string) => void;
};

const disposeRuntime = (runtime: SqlControlPlaneRuntime) =>
  Effect.promise(() => runtime.close()).pipe(Effect.orDie);

const createControlPlaneWebHandler = (runtime: SqlControlPlaneRuntime) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      HttpApiBuilder.toWebHandler(
        Layer.merge(
          createControlPlaneApiLayer(runtime.runtimeLayer),
          HttpServer.layerContext,
        ),
      ),
    ),
    (handler) => Effect.promise(() => handler.dispose()).pipe(Effect.orDie),
  );

const safeFilePath = (assetsDir: string, pathname: string): string | null => {
  const target = resolve(assetsDir, `.${pathname}`);
  const root = resolve(assetsDir);
  return target.startsWith(root) ? target : null;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const wantsHtml = (request: Request): boolean =>
  request.headers.get("accept")?.includes("text/html") ?? false;

const serveUiAsset = async (request: Request, ui: StaticUiOptions): Promise<Response | null> => {
  const url = new URL(request.url);

  if (ui.devServerUrl) {
    const proxyUrl = new URL(`${url.pathname}${url.search}`, ui.devServerUrl);
    return fetch(new Request(proxyUrl.toString(), request));
  }

  if (!ui.assetsDir) {
    return null;
  }

  const candidatePath = safeFilePath(ui.assetsDir, url.pathname);
  if (candidatePath && await fileExists(candidatePath)) {
    return new Response(Bun.file(candidatePath));
  }

  const shouldServeIndex =
    url.pathname === "/"
    || extname(url.pathname).length === 0
    || wantsHtml(request);

  if (!shouldServeIndex) {
    return null;
  }

  const indexPath = resolve(ui.assetsDir, "index.html");
  if (!(await fileExists(indexPath))) {
    return null;
  }

  return new Response(Bun.file(indexPath), {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
};

const isApiRequest = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname;
  return pathname === "/v1" || pathname.startsWith("/v1/");
};

export const createLocalExecutorRequestHandler = (
  options: StartLocalExecutorServerOptions = {},
): Effect.Effect<LocalExecutorRequestHandler, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const localDataDir = options.localDataDir ?? DEFAULT_LOCAL_DATA_DIR;

    if (localDataDir !== ":memory:") {
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(localDataDir), { recursive: true }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
    }

    let baseUrlRef: string | undefined;

    const runtime = yield* Effect.acquireRelease(
      createSqlControlPlaneRuntime({
        localDataDir,
        executionResolver: options.executionResolver,
        resolveSecretMaterial: options.resolveSecretMaterial,
        getLocalServerBaseUrl: () => baseUrlRef,
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      ),
      disposeRuntime,
    );

    const apiHandler = yield* createControlPlaneWebHandler(runtime);

    return {
      runtime,
      handleApiRequest: (request) => apiHandler.handler(request),
      getBaseUrl: () => baseUrlRef,
      setBaseUrl: (baseUrl) => {
        baseUrlRef = baseUrl;
      },
    } satisfies LocalExecutorRequestHandler;
  });

export const createLocalExecutorServer = (
  options: StartLocalExecutorServerOptions = {},
): Effect.Effect<LocalExecutorServer, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const host = options.host ?? DEFAULT_SERVER_HOST;
    const port = options.port ?? DEFAULT_SERVER_PORT;
    const requestHandler = yield* createLocalExecutorRequestHandler(options);

    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: host,
          port,
          fetch: async (request) => {
            if (isApiRequest(request)) {
              return requestHandler.handleApiRequest(request);
            }

            const uiResponse = await serveUiAsset(request, options.ui ?? {});
            if (uiResponse) {
              return uiResponse;
            }

            return new Response("Not Found", { status: 404 });
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    );

    const resolvedUrl = new URL(server.url);
    requestHandler.setBaseUrl(resolvedUrl.origin);

    return {
      runtime: requestHandler.runtime,
      host: resolvedUrl.hostname,
      port: Number(resolvedUrl.port),
      baseUrl: resolvedUrl.origin,
    } satisfies LocalExecutorServer;
  });

export const runLocalExecutorServer = (
  options: StartLocalExecutorServerOptions = {},
): Effect.Effect<void, Error, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* createLocalExecutorServer(options);
      console.error(`executor server listening on ${server.baseUrl}`);

      yield* Effect.async<void, never>((resume) => {
        const shutdown = () => resume(Effect.void);
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);

        return Effect.sync(() => {
          process.off("SIGINT", shutdown);
          process.off("SIGTERM", shutdown);
        });
      });
    }),
  );
