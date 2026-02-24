export interface ProjectProviderSecretMapping {
  provider: string;
  secretName: string;
  keys: Record<string, string>;
}

export interface KubernetesEnvVarProjection {
  name: string;
  valueFrom: {
    secretKeyRef: {
      name: string;
      key: string;
    };
  };
}

interface ProviderEnvSpec {
  envByLogicalKey: Record<string, string>;
  requiredAll?: string[];
  requiredAny?: string[];
}

const apiKeyOnlyProviders: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  zai: "ZAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  huggingface: "HF_TOKEN",
  opencode: "OPENCODE_API_KEY",
  "kimi-coding": "KIMI_API_KEY"
};

const providerSpecs: Record<string, ProviderEnvSpec> = {
  ...Object.fromEntries(
    Object.entries(apiKeyOnlyProviders).map(([provider, envVar]) => [
      provider,
      {
        envByLogicalKey: { apiKey: envVar },
        requiredAll: ["apiKey"]
      }
    ])
  ),
  "openai-codex": {
    envByLogicalKey: {
      apiKey: "OPENAI_API_KEY"
    },
    requiredAll: ["apiKey"]
  },
  "github-copilot": {
    envByLogicalKey: {
      githubToken: "COPILOT_GITHUB_TOKEN"
    },
    requiredAll: ["githubToken"]
  },
  anthropic: {
    envByLogicalKey: {
      apiKey: "ANTHROPIC_API_KEY",
      oauthToken: "ANTHROPIC_OAUTH_TOKEN"
    },
    requiredAny: ["apiKey", "oauthToken"]
  },
  "google-vertex": {
    envByLogicalKey: {
      googleCloudProject: "GOOGLE_CLOUD_PROJECT",
      googleCloudLocation: "GOOGLE_CLOUD_LOCATION",
      googleApplicationCredentials: "GOOGLE_APPLICATION_CREDENTIALS"
    },
    requiredAll: ["googleCloudProject", "googleCloudLocation"]
  },
  "amazon-bedrock": {
    envByLogicalKey: {
      awsAccessKeyId: "AWS_ACCESS_KEY_ID",
      awsSecretAccessKey: "AWS_SECRET_ACCESS_KEY",
      awsProfile: "AWS_PROFILE",
      awsBearerTokenBedrock: "AWS_BEARER_TOKEN_BEDROCK",
      awsWebIdentityTokenFile: "AWS_WEB_IDENTITY_TOKEN_FILE"
    },
    requiredAny: ["awsProfile", "awsBearerTokenBedrock", "awsWebIdentityTokenFile", "awsAccessKeyId"]
  },
  openai: {
    envByLogicalKey: {
      apiKey: "OPENAI_API_KEY",
      orgId: "OPENAI_ORG_ID",
      projectId: "OPENAI_PROJECT_ID",
      baseUrl: "OPENAI_BASE_URL"
    },
    requiredAll: ["apiKey"]
  }
};

function ensureProviderSpec(provider: string): ProviderEnvSpec {
  const spec = providerSpecs[provider];
  if (!spec) {
    throw new Error(`Unsupported provider secret mapping: ${provider}`);
  }
  return spec;
}

function validateRequiredKeys(mapping: ProjectProviderSecretMapping, spec: ProviderEnvSpec): void {
  if (spec.requiredAll) {
    const missing = spec.requiredAll.filter((key) => !mapping.keys[key]);
    if (missing.length > 0) {
      throw new Error(
        `Provider "${mapping.provider}" is missing required secret keys: ${missing.join(", ")}`
      );
    }
  }

  if (spec.requiredAny) {
    const hasAny = spec.requiredAny.some((key) => !!mapping.keys[key]);
    if (!hasAny) {
      throw new Error(
        `Provider "${mapping.provider}" requires one of: ${spec.requiredAny.join(", ")}`
      );
    }
  }
}

export function materializeProviderSecretEnv(
  mapping: ProjectProviderSecretMapping
): KubernetesEnvVarProjection[] {
  if (!mapping.secretName) {
    throw new Error("secretName is required");
  }
  if (!mapping.provider) {
    throw new Error("provider is required");
  }

  const spec = ensureProviderSpec(mapping.provider);
  validateRequiredKeys(mapping, spec);

  const envVars: KubernetesEnvVarProjection[] = [];

  for (const [logicalKey, secretKey] of Object.entries(mapping.keys)) {
    const envName = spec.envByLogicalKey[logicalKey];
    if (!envName) {
      throw new Error(
        `Unknown secret logical key "${logicalKey}" for provider "${mapping.provider}"`
      );
    }

    envVars.push({
      name: envName,
      valueFrom: {
        secretKeyRef: {
          name: mapping.secretName,
          key: secretKey
        }
      }
    });
  }

  return envVars.sort((a, b) => a.name.localeCompare(b.name));
}

export function materializeProjectSecretEnv(
  mappings: ProjectProviderSecretMapping[]
): KubernetesEnvVarProjection[] {
  const merged: KubernetesEnvVarProjection[] = [];
  const seen = new Set<string>();

  for (const mapping of mappings) {
    for (const envVar of materializeProviderSecretEnv(mapping)) {
      if (seen.has(envVar.name)) {
        throw new Error(`Duplicate env var generated from provider mappings: ${envVar.name}`);
      }
      seen.add(envVar.name);
      merged.push(envVar);
    }
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}
