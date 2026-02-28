import type { V1EnvVar, V1Job, V1ResourceRequirements } from "@kubernetes/client-node";

import type { RunExecutionSpec } from "@attractor/shared-types";

export interface ProjectProviderSecretMapping {
  provider: string;
  secretName: string;
  keys: Record<string, string>;
}

interface ProviderEnvSpec {
  envByLogicalKey: Record<string, string>;
  requiredAll?: string[];
  requiredAny?: string[];
}

export interface ProviderSecretSchema {
  provider: string;
  envByLogicalKey: Record<string, string>;
  requiredAll?: string[];
  requiredAny?: string[];
}

const providerSpecs: Record<string, ProviderEnvSpec> = {
  openai: {
    envByLogicalKey: {
      apiKey: "OPENAI_API_KEY",
      orgId: "OPENAI_ORG_ID",
      projectId: "OPENAI_PROJECT_ID",
      baseUrl: "OPENAI_BASE_URL"
    },
    requiredAll: ["apiKey"]
  },
  "openai-codex": {
    envByLogicalKey: {
      apiKey: "OPENAI_API_KEY"
    },
    requiredAll: ["apiKey"]
  },
  anthropic: {
    envByLogicalKey: {
      apiKey: "ANTHROPIC_API_KEY",
      oauthToken: "ANTHROPIC_OAUTH_TOKEN"
    },
    requiredAny: ["apiKey", "oauthToken"]
  },
  google: {
    envByLogicalKey: { apiKey: "GEMINI_API_KEY" },
    requiredAll: ["apiKey"]
  },
  "google-vertex": {
    envByLogicalKey: {
      googleCloudProject: "GOOGLE_CLOUD_PROJECT",
      googleCloudLocation: "GOOGLE_CLOUD_LOCATION",
      googleApplicationCredentials: "GOOGLE_APPLICATION_CREDENTIALS"
    },
    requiredAll: ["googleCloudProject", "googleCloudLocation"]
  },
  "github-app": {
    envByLogicalKey: {
      appId: "GITHUB_APP_ID",
      privateKey: "GITHUB_APP_PRIVATE_KEY",
      appSlug: "GITHUB_APP_SLUG",
      webhookSecret: "GITHUB_WEBHOOK_SECRET",
      token: "GITHUB_TOKEN"
    },
    requiredAll: ["appId", "privateKey"]
  },
  groq: {
    envByLogicalKey: { apiKey: "GROQ_API_KEY" },
    requiredAll: ["apiKey"]
  },
  xai: {
    envByLogicalKey: { apiKey: "XAI_API_KEY" },
    requiredAll: ["apiKey"]
  },
  openrouter: {
    envByLogicalKey: { apiKey: "OPENROUTER_API_KEY" },
    requiredAll: ["apiKey"]
  }
};

function ensureSpec(provider: string): ProviderEnvSpec {
  const spec = providerSpecs[provider];
  if (!spec) {
    throw new Error(`Unsupported provider secret mapping: ${provider}`);
  }
  return spec;
}

function toProviderSecretSchema(provider: string, spec: ProviderEnvSpec): ProviderSecretSchema {
  return {
    provider,
    envByLogicalKey: { ...spec.envByLogicalKey },
    ...(spec.requiredAll ? { requiredAll: [...spec.requiredAll] } : {}),
    ...(spec.requiredAny ? { requiredAny: [...spec.requiredAny] } : {})
  };
}

export function listProviderSecretSchemas(): ProviderSecretSchema[] {
  return Object.entries(providerSpecs)
    .map(([provider, spec]) => toProviderSecretSchema(provider, spec))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function getProviderSecretSchema(provider: string): ProviderSecretSchema | null {
  const spec = providerSpecs[provider];
  if (!spec) {
    return null;
  }
  return toProviderSecretSchema(provider, spec);
}

export function toProjectNamespace(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `factory-proj-${slug || "project"}`;
}

export function materializeProviderSecretEnv(mapping: ProjectProviderSecretMapping): V1EnvVar[] {
  const spec = ensureSpec(mapping.provider);
  if (!mapping.secretName) {
    throw new Error("secretName is required");
  }

  if (spec.requiredAll) {
    const missing = spec.requiredAll.filter((k) => !mapping.keys[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required keys for ${mapping.provider}: ${missing.join(", ")}`);
    }
  }

  if (spec.requiredAny) {
    const hasAny = spec.requiredAny.some((k) => !!mapping.keys[k]);
    if (!hasAny) {
      throw new Error(`Provider ${mapping.provider} requires one of: ${spec.requiredAny.join(", ")}`);
    }
  }

  return Object.entries(mapping.keys).map(([logicalKey, secretKey]) => {
    const envName = spec.envByLogicalKey[logicalKey];
    if (!envName) {
      throw new Error(`Unknown logical key ${logicalKey} for provider ${mapping.provider}`);
    }

    return {
      name: envName,
      valueFrom: {
        secretKeyRef: {
          name: mapping.secretName,
          key: secretKey
        }
      }
    };
  });
}

export function buildRunnerJobManifest(input: {
  runId: string;
  namespace: string;
  image: string;
  executionSpec: RunExecutionSpec;
  secretEnv: V1EnvVar[];
  apiBaseUrl: string;
  redisUrl: string;
  postgresUrl: string;
  minioEndpoint: string;
  minioBucket: string;
  minioAccessKey: string;
  minioSecretKey: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubToken?: string;
  defaultServiceAccountName?: string;
}): V1Job {
  const name = `factory-run-${input.runId}`.slice(0, 63);
  const environment = input.executionSpec.environment;
  const defaultResources: V1ResourceRequirements = {
    requests: {
      cpu: "500m",
      memory: "1Gi"
    },
    limits: {
      cpu: "2",
      memory: "4Gi"
    }
  };
  const resources: V1ResourceRequirements = {
    requests: {
      ...defaultResources.requests,
      ...(environment.resources?.requests ?? {})
    },
    limits: {
      ...defaultResources.limits,
      ...(environment.resources?.limits ?? {})
    }
  };

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      namespace: input.namespace,
      name,
      labels: {
        "app.kubernetes.io/name": "factory-runner",
        "attractor.run/id": input.runId
      }
    },
    spec: {
      ttlSecondsAfterFinished: 86400,
      activeDeadlineSeconds: 7200,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "factory-runner",
            "attractor.run/id": input.runId
          }
        },
        spec: {
          restartPolicy: "Never",
          serviceAccountName:
            environment.serviceAccountName ??
            input.defaultServiceAccountName ??
            "factory-runner",
          containers: [
            {
              name: "runner",
              image: input.image,
              imagePullPolicy: "IfNotPresent",
              command: ["node", "apps/factory-runner/dist/apps/factory-runner/src/main.js"],
              env: [
                { name: "RUN_EXECUTION_SPEC", value: JSON.stringify(input.executionSpec) },
                { name: "RUN_ENVIRONMENT_SPEC", value: JSON.stringify(environment) },
                { name: "FACTORY_API_BASE_URL", value: input.apiBaseUrl },
                { name: "REDIS_URL", value: input.redisUrl },
                { name: "DATABASE_URL", value: input.postgresUrl },
                { name: "MINIO_ENDPOINT", value: input.minioEndpoint },
                { name: "MINIO_BUCKET", value: input.minioBucket },
                { name: "MINIO_ACCESS_KEY", value: input.minioAccessKey },
                { name: "MINIO_SECRET_KEY", value: input.minioSecretKey },
                ...(input.githubAppId ? [{ name: "GITHUB_APP_ID", value: input.githubAppId }] : []),
                ...(input.githubAppPrivateKey
                  ? [{ name: "GITHUB_APP_PRIVATE_KEY", value: input.githubAppPrivateKey }]
                  : []),
                ...(input.githubToken ? [{ name: "GITHUB_TOKEN", value: input.githubToken }] : []),
                ...input.secretEnv
              ],
              resources
            }
          ]
        }
      }
    }
  };
}
