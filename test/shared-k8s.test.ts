import { describe, expect, it } from "vitest";

import { buildRunnerJobManifest, materializeProviderSecretEnv, toProjectNamespace } from "../packages/shared-k8s/src/index.ts";

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
      minioSecretKey: "minioadmin"
    });

    const env = job.spec?.template.spec?.containers?.[0]?.env ?? [];
    const envNames = env.map((item) => item.name);

    expect(envNames).toContain("RUN_EXECUTION_SPEC");
    expect(envNames).toContain("MINIO_ACCESS_KEY");
    expect(envNames).toContain("MINIO_SECRET_KEY");
  });
});
