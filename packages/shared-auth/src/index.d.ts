export declare const DEFAULT_FACTORY_AUTH_BASIC_USERNAME = "factory";
export declare const DEFAULT_FACTORY_AUTH_BASIC_REALM = "Attractor Factory";

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

export declare function resolveAuthConfig(env: NodeJS.ProcessEnv): AuthConfig;
export declare function isAuthEnabled(config: AuthConfig): config is AuthEnabledConfig;
export declare function parseBasicAuthorization(
  value: string | string[] | undefined
): BasicAuthCredentials | null;
export declare function verifyPasswordHash(passwordHash: string, password: string): boolean;
export declare function authenticateBasicHeader(
  value: string | string[] | undefined,
  config: AuthConfig
): AuthenticatedPrincipal | null;
export declare function buildWwwAuthenticateHeader(config: AuthEnabledConfig): string;
