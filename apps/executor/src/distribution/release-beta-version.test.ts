import { describe, expect, it } from "vitest";

import { resolveNextBetaVersion } from "./release-beta-version";

describe("resolveNextBetaVersion", () => {
  it("starts a beta prerelease from a stable version", () => {
    expect(resolveNextBetaVersion("1.1.9")).toBe("1.1.10-beta.0");
  });

  it("increments an existing beta prerelease", () => {
    expect(resolveNextBetaVersion("1.1.10-beta.0")).toBe("1.1.10-beta.1");
  });

  it("rejects unsupported prerelease inputs", () => {
    expect(() => resolveNextBetaVersion("1.2.0-rc.1")).toThrow(
      "Unsupported version for automatic beta release",
    );
  });
});
