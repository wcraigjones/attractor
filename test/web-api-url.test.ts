import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApiUrl, getApiBase, listProjects } from "../apps/factory-web/src/client/lib/api";

describe("web api URL helpers", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.restoreAllMocks();
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

  it("reloads the page when an API request receives 401", async () => {
    const reload = vi.fn();
    (globalThis as {
      window: {
        __FACTORY_APP_CONFIG__?: { apiBaseUrl?: string };
        location: { reload: () => void };
      };
    }).window = {
      __FACTORY_APP_CONFIG__: {
        apiBaseUrl: "/api"
      },
      location: {
        reload
      }
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "authentication required" })
      })
    );

    await expect(listProjects()).rejects.toThrow("authentication required");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
