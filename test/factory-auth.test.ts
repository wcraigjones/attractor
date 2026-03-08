import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authenticateBasicHeader,
  buildWwwAuthenticateHeader,
  parseBasicAuthorization,
  resolveAuthConfig,
  verifyPasswordHash
} from "@attractor/shared-auth";

function createPasswordHash(password: string): string {
  const salt = Buffer.from("factory-auth-test-salt", "utf8");
  const derivedKey = scryptSync(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

const TEST_PASSWORD = "correct horse battery staple";
const TEST_PASSWORD_HASH = createPasswordHash(TEST_PASSWORD);

describe("shared factory auth", () => {
  it("disables auth when password hash is unset", () => {
    expect(resolveAuthConfig({})).toEqual({ enabled: false });
  });

  it("uses default username and realm", () => {
    const config = resolveAuthConfig({
      FACTORY_AUTH_BASIC_PASSWORD_HASH: TEST_PASSWORD_HASH
    });

    expect(config).toEqual({
      enabled: true,
      username: "factory",
      realm: "Attractor Factory",
      passwordHash: TEST_PASSWORD_HASH
    });
  });

  it("throws when the password hash is malformed", () => {
    expect(() =>
      resolveAuthConfig({
        FACTORY_AUTH_BASIC_PASSWORD_HASH: "not-a-valid-hash"
      })
    ).toThrow(/FACTORY_AUTH_BASIC_PASSWORD_HASH/);
  });

  it("verifies the correct password and rejects the wrong one", () => {
    expect(verifyPasswordHash(TEST_PASSWORD_HASH, TEST_PASSWORD)).toBe(true);
    expect(verifyPasswordHash(TEST_PASSWORD_HASH, "wrong password")).toBe(false);
  });

  it("parses a valid basic authorization header", () => {
    const header = `Basic ${Buffer.from("factory:secret", "utf8").toString("base64")}`;
    expect(parseBasicAuthorization(header)).toEqual({
      username: "factory",
      password: "secret"
    });
  });

  it("rejects malformed basic authorization headers", () => {
    expect(parseBasicAuthorization("Bearer nope")).toBeNull();
    expect(parseBasicAuthorization("Basic !!!")).toBeNull();
    expect(parseBasicAuthorization("Basic ")).toBeNull();
  });

  it("authenticates a valid header and returns the configured username", () => {
    const config = resolveAuthConfig({
      FACTORY_AUTH_BASIC_PASSWORD_HASH: TEST_PASSWORD_HASH,
      FACTORY_AUTH_BASIC_USERNAME: "factory-admin"
    });
    if (!config.enabled) {
      throw new Error("expected auth to be enabled");
    }

    const header = `Basic ${Buffer.from(`factory-admin:${TEST_PASSWORD}`, "utf8").toString("base64")}`;
    expect(authenticateBasicHeader(header, config)).toEqual({
      username: "factory-admin"
    });
  });

  it("rejects an incorrect username even with the correct password", () => {
    const config = resolveAuthConfig({
      FACTORY_AUTH_BASIC_PASSWORD_HASH: TEST_PASSWORD_HASH,
      FACTORY_AUTH_BASIC_USERNAME: "factory-admin"
    });
    if (!config.enabled) {
      throw new Error("expected auth to be enabled");
    }

    const header = `Basic ${Buffer.from(`factory:${TEST_PASSWORD}`, "utf8").toString("base64")}`;
    expect(authenticateBasicHeader(header, config)).toBeNull();
  });

  it("builds a basic auth challenge header using the configured realm", () => {
    const config = resolveAuthConfig({
      FACTORY_AUTH_BASIC_PASSWORD_HASH: TEST_PASSWORD_HASH,
      FACTORY_AUTH_BASIC_REALM: "Factory Control Plane"
    });
    if (!config.enabled) {
      throw new Error("expected auth to be enabled");
    }

    expect(buildWwwAuthenticateHeader(config)).toBe('Basic realm="Factory Control Plane"');
  });
});
