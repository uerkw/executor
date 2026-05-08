import { describe, expect, it } from "@effect/vitest";

import { SourceFavicon } from "./source-favicon";

describe("SourceFavicon", () => {
  it("renders without requesting an external favicon service", () => {
    const element = SourceFavicon({ url: "https://internal.example.test/private", size: 20 });

    expect(element.type).not.toBe("img");
    expect(element.props).not.toHaveProperty("src");
    expect(element.props).not.toHaveProperty("href");
  });
});
