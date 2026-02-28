import { describe, expect, it } from "vitest";

import {
  buildRunnerJobManifest,
  getProviderSecretSchema,
  listProviderSecretSchemas,
  materializeProviderSecretEnv,
  toProjectNamespace
} from "../packages/shared-k8s/src/index.ts";

describe("shared k8s helpers", () => {
  it("builds project namespaces with stable prefix", () => {
    expect(toProjectNamespace("Attractor Self")).toBe("factory-proj-attractor-self");
    expect(toProjectNamespace("@@@")).toBe("factory-proj-project");
  });

  it("materializes provider env vars", () => {
    const env = materializeProviderSecretEnv({
      provider: "openai",
      secretName: "proj-secret",
      keys: { apiKey: "openai_api_key" }
    });

    expect(env).toEqual([
      {
        name: "OPENAI_API_KEY",
        valueFrom: {
          secretKeyRef: {
            name: "proj-secret",
            key: "openai_api_key"
          }
        }
      }
    ]);
  });

  it("returns provider secret schemas for UI/bootstrap tooling", () => {
    const schemas = listProviderSecretSchemas();
    expect(schemas.length).toBeGreaterThan(0);

    const anthropic = getProviderSecretSchema("anthropic");
    expect(anthropic).toBeTruthy();
    expect(anthropic?.requiredAny).toContain("apiKey");
    expect(anthropic?.envByLogicalKey.oauthToken).toBe("ANTHROPIC_OAUTH_TOKEN");

    const githubApp = getProviderSecretSchema("github-app");
    expect(githubApp).toBeTruthy();
    expect(githubApp?.requiredAll).toEqual(["appId", "privateKey"]);
    expect(githubApp?.envByLogicalKey.appId).toBe("GITHUB_APP_ID");
  });

  it("adds minio credentials and execution spec to runner job", () => {
    const job = buildRunnerJobManifest({
      runId: "run-123",
      namespace: "factory-proj-attractor",
      image: "attractor/factory-runner:dev",
      executionSpec: {
        runId: "run-123",
        projectId: "project-1",
        runType: "planning",
        attractorDefId: "attractor-1",
        environment: {
          id: "env-1",
          name: "default-k8s",
          kind: "KUBERNETES_JOB",
          runnerImage: "attractor/factory-runner@sha256:1111111111111111111111111111111111111111111111111111111111111111",
          serviceAccountName: "custom-runner",
          resources: {
            requests: { cpu: "750m" },
            limits: { memory: "6Gi" }
          }
        },
        sourceBranch: "main",
        targetBranch: "attractor/run-123",
        modelConfig: { provider: "openai", modelId: "gpt-4.1-mini" },
        secretsRef: ["llm-secret"],
        artifactPrefix: "project-1/run-123"
      },
      secretEnv: [],
      apiBaseUrl: "http://factory-api.factory-system.svc.cluster.local:8080",
      redisUrl: "redis://redis.factory-system.svc.cluster.local:6379",
      postgresUrl: "postgresql://postgres:postgres@postgres.factory-system.svc.cluster.local:5432/factory",
      minioEndpoint: "http://minio.factory-system.svc.cluster.local:9000",
      minioBucket: "factory-artifacts",
      minioAccessKey: "minioadmin",
      minioSecretKey: "minioadmin",
      defaultServiceAccountName: "factory-runner"
    });

    const container = job.spec?.template.spec?.containers?.[0];
    const env = container?.env ?? [];
    const envNames = env.map((item) => item.name);

    expect(envNames).toContain("RUN_EXECUTION_SPEC");
    expect(envNames).toContain("RUN_ENVIRONMENT_SPEC");
    expect(envNames).toContain("MINIO_ACCESS_KEY");
    expect(envNames).toContain("MINIO_SECRET_KEY");
    expect(job.spec?.template.spec?.serviceAccountName).toBe("custom-runner");
    expect(container?.resources?.requests?.cpu).toBe("750m");
    expect(container?.resources?.limits?.memory).toBe("6Gi");
    expect(container?.resources?.requests?.memory).toBe("1Gi");
  });
});
