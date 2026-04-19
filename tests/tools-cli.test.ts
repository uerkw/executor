import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  buildToolPath,
  buildInvokeToolCode,
  buildListSourcesCode,
  buildSearchToolsCode,
  extractExecutionId,
  extractExecutionResult,
  inspectToolPath,
  parseJsonObjectInput,
} from "../apps/cli/src/tooling";

describe("CLI tooling helpers", () => {
  it.effect("parses empty input as an empty args object", () =>
    Effect.gen(function* () {
      const args = yield* parseJsonObjectInput(undefined);
      expect(args).toEqual({});
    }),
  );

  it.effect("parses JSON object input", () =>
    Effect.gen(function* () {
      const args = yield* parseJsonObjectInput('{"calendarId":"primary"}');
      expect(args).toEqual({ calendarId: "primary" });
    }),
  );

  it.effect("rejects non-object JSON input", () =>
    Effect.gen(function* () {
      const error = yield* parseJsonObjectInput('[1,2,3]').pipe(Effect.flip);
      expect(error.message).toContain("must decode to a JSON object");
    }),
  );

  it("builds bracket-safe invocation code for dynamic tool paths", () => {
    const code = buildInvokeToolCode("google-drive.files.list", { pageSize: 10 });
    expect(code).toContain('const __target = tools["google-drive"]["files"]["list"]');
    expect(code).toContain('const __args = {');
  });

  it("builds tool paths from dot or segmented forms", () => {
    expect(buildToolPath(["github", "issues", "create"])).toBe("github.issues.create");
    expect(buildToolPath(["github.issues", "create"])).toBe("github.issues.create");
  });

  it("rejects invalid tool-path segments", () => {
    expect(() => buildToolPath(["github", "issues", "create now"])).toThrow();
  });

  it("builds search and sources code snippets", () => {
    const searchCode = buildSearchToolsCode({
      query: "google calendar events",
      namespace: "google",
      limit: 5,
    });
    const sourcesCode = buildListSourcesCode({ query: "google", limit: 20 });

    expect(searchCode).toBe(
      'return await tools.search({"query":"google calendar events","limit":5,"namespace":"google"});',
    );
    expect(sourcesCode).toBe('return await tools.executor.sources.list({"limit":20,"query":"google"});');
  });

  it("extracts completed result payload and pause execution id", () => {
    expect(extractExecutionResult({ status: "completed", result: { ok: true }, logs: [] })).toEqual({
      ok: true,
    });
    expect(extractExecutionResult({ status: "completed" })).toBeNull();

    expect(extractExecutionId({ executionId: "exec_123" })).toBe("exec_123");
    expect(extractExecutionId({ executionId: 123 })).toBeUndefined();
  });

  it("inspects hierarchical tool path prefixes for call help", () => {
    const view = inspectToolPath({
      toolPaths: [
        "cloudflare.dns.records.list",
        "cloudflare.dns.records.create",
        "cloudflare.dns.analytics",
        "cloudflare.zones.list",
      ],
      rawPrefixParts: ["cloudflare", "dns"],
    });

    expect(view.prefixSegments).toEqual(["cloudflare", "dns"]);
    expect(view.exactPath).toBeUndefined();
    expect(view.matchingToolCount).toBe(3);
    expect(view.children).toEqual([
      { segment: "analytics", invokable: true, hasChildren: false, toolCount: 1 },
      { segment: "records", invokable: false, hasChildren: true, toolCount: 2 },
    ]);
  });

  it("reports exact matches for leaf tool paths", () => {
    const view = inspectToolPath({
      toolPaths: ["github.issues.create", "github.issues.list"],
      rawPrefixParts: ["github", "issues", "create"],
    });

    expect(view.prefixSegments).toEqual(["github", "issues", "create"]);
    expect(view.exactPath).toBe("github.issues.create");
    expect(view.matchingToolCount).toBe(1);
    expect(view.children).toEqual([]);
  });
});
