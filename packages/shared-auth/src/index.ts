import { scryptSync, timingSafeEqual } from "node:crypto";

export const DEFAULT_FACTORY_AUTH_BASIC_USERNAME = "factory";
export const DEFAULT_FACTORY_AUTH_BASIC_REALM = "Attractor Factory";

const PASSWORD_HASH_ENV_KEY = "FACTORY_AUTH_BASIC_PASSWORD_HASH";
const USERNAME_ENV_KEY = "FACTORY_AUTH_BASIC_USERNAME";
const REALM_ENV_KEY = "FACTORY_AUTH_BASIC_REALM";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export interface AuthDisabledConfig {
  enabled: false;
}

export interface AuthEnabledConfig {
  enabled: true;
  username: string;
  realm: string;
  passwordHash: string;
}

export type AuthConfig = AuthDisabledConfig | AuthEnabledConfig;

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

export interface AuthenticatedPrincipal {
  username: string;
}

interface ParsedPasswordHash {
  algorithm: "scrypt";
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  derivedKey: Buffer;
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBase64Url(value: string, label: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error(`${label} must be base64url encoded`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return decoded;
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return parsed;
}

function validateUsername(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${USERNAME_ENV_KEY} must not be empty`);
  }
  if (normalized.includes(":")) {
    throw new Error(`${USERNAME_ENV_KEY} must not contain ':'`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`${USERNAME_ENV_KEY} must not contain control characters`);
  }
  return normalized;
}

function validateRealm(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${REALM_ENV_KEY} must not be empty`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`${REALM_ENV_KEY} must not contain control characters`);
  }
  return normalized;
}

function parsePasswordHash(passwordHash: string): ParsedPasswordHash {
  const parts = passwordHash.trim().split("$");
  if (parts.length !== 6) {
    throw new Error(`${PASSWORD_HASH_ENV_KEY} must match scrypt$<N>$<r>$<p>$<salt>$<derivedKey>`);
  }

  const [algorithm, costValue, blockSizeValue, parallelizationValue, saltValue, derivedKeyValue] =
    parts;
  if (algorithm !== "scrypt") {
    throw new Error(`${PASSWORD_HASH_ENV_KEY} algorithm must be scrypt`);
  }

  const cost = parsePositiveInteger(costValue ?? "", "scrypt cost");
  if (cost < 2 || (cost & (cost - 1)) !== 0) {
    throw new Error("scrypt cost must be a power of two greater than 1");
  }

  const blockSize = parsePositiveInteger(blockSizeValue ?? "", "scrypt block size");
  const parallelization = parsePositiveInteger(
    parallelizationValue ?? "",
    "scrypt parallelization"
  );

  return {
    algorithm: "scrypt",
    cost,
    blockSize,
    parallelization,
    salt: decodeBase64Url(saltValue ?? "", "scrypt salt"),
    derivedKey: decodeBase64Url(derivedKeyValue ?? "", "scrypt derived key")
  };
}

export function resolveAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const passwordHash = (env[PASSWORD_HASH_ENV_KEY] ?? "").trim();
  if (!passwordHash) {
    return { enabled: false };
  }

  parsePasswordHash(passwordHash);

  return {
    enabled: true,
    username: validateUsername(env[USERNAME_ENV_KEY] ?? DEFAULT_FACTORY_AUTH_BASIC_USERNAME),
    realm: validateRealm(env[REALM_ENV_KEY] ?? DEFAULT_FACTORY_AUTH_BASIC_REALM),
    passwordHash
  };
}

export function isAuthEnabled(config: AuthConfig): config is AuthEnabledConfig {
  return config.enabled;
}

export function parseBasicAuthorization(
  value: string | string[] | undefined
): BasicAuthCredentials | null {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  const separator = normalized.indexOf(" ");
  if (separator <= 0) {
    return null;
  }

  const scheme = normalized.slice(0, separator);
  if (scheme.toLowerCase() !== "basic") {
    return null;
  }

  const encoded = normalized.slice(separator + 1).trim();
  if (!encoded || !BASE64_PATTERN.test(encoded) || encoded.length % 4 === 1) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const credentialSeparator = decoded.indexOf(":");
  if (credentialSeparator < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, credentialSeparator),
    password: decoded.slice(credentialSeparator + 1)
  };
}

export function verifyPasswordHash(passwordHash: string, password: string): boolean {
  const parsed = parsePasswordHash(passwordHash);
  const actual = scryptSync(password, parsed.salt, parsed.derivedKey.length, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelization
  });
  return timingSafeEqual(actual, parsed.derivedKey);
}

export function authenticateBasicHeader(
  value: string | string[] | undefined,
  config: AuthConfig
): AuthenticatedPrincipal | null {
  if (!config.enabled) {
    return null;
  }

  const credentials = parseBasicAuthorization(value);
  if (!credentials) {
    return null;
  }
  if (!safeEqualText(credentials.username, config.username)) {
    return null;
  }
  if (!verifyPasswordHash(config.passwordHash, credentials.password)) {
    return null;
  }

  return {
    username: config.username
  };
}

export function buildWwwAuthenticateHeader(config: AuthEnabledConfig): string {
  const escapedRealm = config.realm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `Basic realm="${escapedRealm}"`;
}
