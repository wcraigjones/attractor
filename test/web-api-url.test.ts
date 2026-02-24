import { afterEach, describe, expect, it } from "vitest";

import { buildApiUrl, getApiBase } from "../apps/factory-web/src/client/lib/api";

describe("web api URL helpers", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("uses app config API base and deduplicates /api", () => {
    (globalThis as { window: { __FACTORY_APP_CONFIG__?: { apiBaseUrl?: string } } }).window = {
      __FACTORY_APP_CONFIG__: {
        apiBaseUrl: "/api"
      }
    };

    expect(getApiBase()).toBe("/api");
    expect(buildApiUrl("/api/projects")).toBe("/api/projects");
    expect(buildApiUrl("/projects")).toBe("/api/projects");
  });

  it("supports absolute API base URL", () => {
    (globalThis as { window: { __FACTORY_APP_CONFIG__?: { apiBaseUrl?: string } } }).window = {
      __FACTORY_APP_CONFIG__: {
        apiBaseUrl: "http://localhost:8080"
      }
    };

    expect(buildApiUrl("/api/runs")).toBe("http://localhost:8080/api/runs");
  });
});
