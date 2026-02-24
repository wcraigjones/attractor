import { describe, expect, it } from "vitest";

import {
  materializeProjectSecretEnv,
  materializeProviderSecretEnv
} from "../src/secrets/provider-env.js";

describe("provider secret env materialization", () => {
  it("maps OpenAI secret keys to pi-ai env vars", () => {
    const envVars = materializeProviderSecretEnv({
      provider: "openai",
      secretName: "project-secrets",
      keys: {
        apiKey: "openai_api_key",
        orgId: "openai_org_id"
      }
    });

    expect(envVars).toEqual([
      {
        name: "OPENAI_API_KEY",
        valueFrom: {
          secretKeyRef: {
            name: "project-secrets",
            key: "openai_api_key"
          }
        }
      },
      {
        name: "OPENAI_ORG_ID",
        valueFrom: {
          secretKeyRef: {
            name: "project-secrets",
            key: "openai_org_id"
          }
        }
      }
    ]);
  });

  it("supports Anthropic OAuth token mapping", () => {
    const envVars = materializeProviderSecretEnv({
      provider: "anthropic",
      secretName: "project-secrets",
      keys: {
        oauthToken: "anthropic_oauth_token"
      }
    });

    expect(envVars[0]?.name).toBe("ANTHROPIC_OAUTH_TOKEN");
    expect(envVars[0]?.valueFrom.secretKeyRef.key).toBe("anthropic_oauth_token");
  });

  it("merges project mappings and rejects duplicate env vars", () => {
    expect(() =>
      materializeProjectSecretEnv([
        {
          provider: "openai",
          secretName: "project-secrets",
          keys: { apiKey: "openai_key" }
        },
        {
          provider: "openai-codex",
          secretName: "project-secrets",
          keys: { apiKey: "codex_key" }
        }
      ])
    ).toThrowError("Duplicate env var generated from provider mappings: OPENAI_API_KEY");
  });
});
