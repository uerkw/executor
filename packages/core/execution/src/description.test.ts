import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Executor, Source } from "@executor/sdk";

import { buildExecuteDescription } from "./description";

const makeSource = (overrides: Partial<Source> & Pick<Source, "id" | "name">): Source => ({
  kind: "in-memory",
  pluginId: "test-plugin",
  canRemove: false,
  canRefresh: false,
  canEdit: false,
  runtime: false,
  ...overrides,
});

const makeFakeExecutor = (sources: readonly Source[]): Executor =>
  ({
    sources: {
      list: () => Effect.succeed(sources),
    },
  }) as unknown as Executor;

describe("buildExecuteDescription", () => {
  it.effect("includes the workflow preamble and lists sources sorted by id", () =>
    Effect.gen(function* () {
      const sources: readonly Source[] = [
        // Intentionally out of order — the formatter is expected to sort.
        makeSource({ id: "slack", name: "Slack Workspace" }),
        makeSource({ id: "github", name: "GitHub" }),
      ];
      const executor = makeFakeExecutor(sources);

      const description = yield* buildExecuteDescription(executor);

      // Stable anchor from the workflow preamble.
      expect(description).toContain(
        "Execute TypeScript in a sandboxed runtime",
      );
      // The namespaces section header.
      expect(description).toContain("## Available namespaces");
      // Both sources rendered with backticks + label-suffix rule.
      expect(description).toContain("`github` — GitHub");
      expect(description).toContain("`slack` — Slack Workspace");

      // Sort order: `github` appears before `slack`.
      const githubIdx = description.indexOf("`github`");
      const slackIdx = description.indexOf("`slack`");
      expect(githubIdx).toBeGreaterThan(-1);
      expect(slackIdx).toBeGreaterThan(-1);
      expect(githubIdx).toBeLessThan(slackIdx);
    }),
  );

  it.effect("omits the Available namespaces section when there are no sources", () =>
    Effect.gen(function* () {
      const executor = makeFakeExecutor([]);

      const description = yield* buildExecuteDescription(executor);

      expect(description).toContain(
        "Execute TypeScript in a sandboxed runtime",
      );
      expect(description).not.toContain("## Available namespaces");
    }),
  );
});
