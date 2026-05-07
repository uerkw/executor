import { describe, expect, it } from "@effect/vitest";
import { ScopeId } from "@executor-js/sdk";

import { secretsForCredentialTarget } from "./secret-header-auth";

describe("secretsForCredentialTarget", () => {
  it("only exposes secrets owned by the target credential scope", () => {
    expect(
      secretsForCredentialTarget(
        [
          { id: "shared-token", scopeId: "org", name: "Shared token" },
          { id: "personal-token", scopeId: "user", name: "Personal token" },
        ],
        ScopeId.make("org"),
      ).map((secret) => secret.id),
    ).toEqual(["shared-token"]);
  });
});
