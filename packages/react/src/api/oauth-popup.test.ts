import { describe, expect, it } from "@effect/vitest";

import { openOAuthPopup } from "./oauth-popup";

type OAuthPopupTestWindow = {
  readonly screenX: number;
  readonly screenY: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
  readonly location: { readonly origin: string };
  readonly addEventListener: () => void;
  readonly removeEventListener: () => void;
  readonly open: (
    url: string,
    name: string,
    features: string,
  ) => { readonly closed: boolean; close: () => void };
};

describe("openOAuthPopup", () => {
  it("does not open unsupported OAuth endpoint URLs", async () => {
    let openFailed = false;
    const teardown = openOAuthPopup({
      url: "javascript:alert(1)",
      popupName: "oauth",
      channelName: "oauth-channel",
      onResult: () => {},
      onOpenFailed: () => {
        openFailed = true;
      },
    });

    teardown();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(openFailed).toBe(true);
  });

  it("opens supported OAuth URLs without opener access", () => {
    let features = "";
    const previousWindow = globalThis.window;
    const fakeWindow: OAuthPopupTestWindow = {
      screenX: 0,
      screenY: 0,
      outerWidth: 1200,
      outerHeight: 900,
      location: { origin: "https://app.example" },
      addEventListener: () => {},
      removeEventListener: () => {},
      open: (_url: string, _name: string, requestedFeatures: string) => {
        features = requestedFeatures;
        return { closed: false, close: () => {} };
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
      writable: true,
    });

    const teardown = openOAuthPopup({
      url: "https://auth.example/authorize",
      popupName: "oauth",
      channelName: "oauth-channel",
      onResult: () => {},
    });

    teardown();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
      writable: true,
    });
    expect(features).toContain("noopener");
    expect(features).toContain("noreferrer");
  });

  it("opens HTTP authorization URLs returned by local flows", () => {
    let opened = "";
    const previousWindow = globalThis.window;
    const fakeWindow: OAuthPopupTestWindow = {
      screenX: 0,
      screenY: 0,
      outerWidth: 1200,
      outerHeight: 900,
      location: { origin: "http://127.0.0.1:4000" },
      addEventListener: () => {},
      removeEventListener: () => {},
      open: (url: string) => {
        opened = url;
        return { closed: false, close: () => {} };
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
      writable: true,
    });

    const teardown = openOAuthPopup({
      url: "http://example.com/authorize",
      popupName: "oauth",
      channelName: "oauth-channel",
      onResult: () => {},
    });

    teardown();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
      writable: true,
    });
    expect(opened).toBe("http://example.com/authorize");
  });
});
