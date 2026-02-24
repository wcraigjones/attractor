import { describe, expect, it } from "vitest";

import { routeApiRequest } from "../src/api/server.js";

describe("model catalog API routes", () => {
  it("returns provider catalog", () => {
    const response = routeApiRequest("GET", "/api/models/providers");
    expect(response.status).toBe(200);

    const body = response.body as { providers: string[] };
    expect(body.providers.length).toBeGreaterThan(0);
  });

  it("returns models for a provider", () => {
    const providersResponse = routeApiRequest("GET", "/api/models/providers");
    const provider = (providersResponse.body as { providers: string[] }).providers[0];
    expect(provider).toBeTruthy();

    const response = routeApiRequest("GET", `/api/models?provider=${provider}`);
    expect(response.status).toBe(200);

    const body = response.body as {
      provider: string;
      models: Array<{ id: string }>;
    };
    expect(body.provider).toBe(provider);
    expect(body.models.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown providers", () => {
    const response = routeApiRequest("GET", "/api/models?provider=nope");
    expect(response.status).toBe(404);
  });
});
