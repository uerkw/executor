import { describe, expect, it } from "@effect/vitest";

import { sourceFaviconUrl } from "./source-favicon";

describe("SourceFavicon", () => {
  it("uses the source site's own favicon for public URLs", () => {
    expect(sourceFaviconUrl("https://api.github.com/graphql", 20)).toBe(
      "https://github.com/favicon.ico?sz=40",
    );
  });

  it("does not request favicons for local URLs", () => {
    expect(sourceFaviconUrl("http://localhost:3000/private", 20)).toBeNull();
    expect(sourceFaviconUrl("http://127.0.0.1:3000/private", 20)).toBeNull();
    expect(sourceFaviconUrl("http://api.local/private", 20)).toBeNull();
  });

  it("does not send source URLs to a third-party favicon service", () => {
    expect(sourceFaviconUrl("https://internal.example.test/private", 20)).not.toContain(
      "google.com",
    );
  });
});
