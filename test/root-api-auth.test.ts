import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { scryptSync } from "node:crypto";

import { resolveAuthConfig } from "@attractor/shared-auth";
import { createApiServer } from "../src/api/server.js";

function createPasswordHash(password: string): string {
  const salt = Buffer.from("root-api-auth-salt", "utf8");
  const derivedKey = scryptSync(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

describe("root API basic auth", () => {
  const password = "super secret";
  const authConfig = resolveAuthConfig({
    FACTORY_AUTH_BASIC_PASSWORD_HASH: createPasswordHash(password)
  });
  const server = createApiServer(authConfig);
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("returns 401 without auth when basic auth is enabled", async () => {
    const response = await fetch(`${baseUrl}/api/models/providers`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('Basic realm="Attractor Factory"');
  });

  it("returns 200 with valid auth credentials", async () => {
    const response = await fetch(`${baseUrl}/api/models/providers`, {
      headers: {
        authorization: `Basic ${Buffer.from(`factory:${password}`, "utf8").toString("base64")}`
      }
    });
    expect(response.status).toBe(200);
  });

  it("keeps /healthz public", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
  });
});
