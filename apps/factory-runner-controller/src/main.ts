import { BatchV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { PrismaClient, RunStatus, RunType } from "@prisma/client";
import { Redis } from "ioredis";
import {
  runCancelKey,
  runEventChannel,
  runLockKey,
  runQueueKey,
  type RunExecutionSpec,
  type RunModelConfig
} from "@attractor/shared-types";
import {
  buildRunnerJobManifest,
  materializeProviderSecretEnv,
  type ProjectProviderSecretMapping
} from "@attractor/shared-k8s";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const POLL_TIMEOUT_SECONDS = Number(process.env.RUN_QUEUE_POLL_TIMEOUT_SECONDS ?? 5);
const PROJECT_CONCURRENCY_LIMIT = Number(process.env.PROJECT_CONCURRENCY_LIMIT ?? 5);
const RUNNER_IMAGE = process.env.RUNNER_IMAGE ?? "ghcr.io/wcraigjones/attractor-runner:latest";
const FACTORY_API_BASE_URL = process.env.FACTORY_API_BASE_URL ?? "http://factory-api.factory-system.svc.cluster.local:8080";
const POSTGRES_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@postgres.factory-system.svc.cluster.local:5432/factory";
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://minio.factory-system.svc.cluster.local:9000";
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "factory-artifacts";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "minioadmin";
const SERVICE_ACCOUNT = process.env.RUNNER_SERVICE_ACCOUNT ?? "factory-runner";

const kc = new KubeConfig();
kc.loadFromDefault();
const coreApi = kc.makeApiClient(CoreV1Api);
const batchApi = kc.makeApiClient(BatchV1Api);

async function appendRunEvent(runId: string, type: string, payload: unknown): Promise<void> {
  const event = await prisma.runEvent.create({
    data: {
      runId,
      type,
      payload: payload as never
    }
  });

  await redis.publish(
    runEventChannel(runId),
    JSON.stringify({
      id: event.id,
      runId,
      ts: event.ts.toISOString(),
      type,
      payload
    })
  );
}

async function ensureServiceAccount(namespace: string, serviceAccountName: string): Promise<void> {
  try {
    await coreApi.readNamespacedServiceAccount({ namespace, name: serviceAccountName });
    return;
  } catch {
    await coreApi.createNamespacedServiceAccount({
      namespace,
      body: {
        apiVersion: "v1",
        kind: "ServiceAccount",
        metadata: {
          namespace,
          name: serviceAccountName
        }
      }
    });
  }
}

async function modelConfigForRun(runId: string): Promise<RunModelConfig> {
  const queuedEvent = await prisma.runEvent.findFirst({
    where: {
      runId,
      type: "RunQueued"
    },
    orderBy: {
      ts: "asc"
    }
  });

  if (!queuedEvent || typeof queuedEvent.payload !== "object" || !queuedEvent.payload) {
    throw new Error(`RunQueued event missing modelConfig for run ${runId}`);
  }

  const payload = queuedEvent.payload as { modelConfig?: RunModelConfig };
  if (!payload.modelConfig?.provider || !payload.modelConfig?.modelId) {
    throw new Error(`RunQueued modelConfig invalid for run ${runId}`);
  }

  return payload.modelConfig;
}

async function enqueueRun(runId: string): Promise<void> {
  await redis.rpush(runQueueKey(), runId);
}

async function processRun(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      project: true,
      attractorDef: true,
      referencedSpecBundle: true
    }
  });

  if (!run) {
    return;
  }

  if (run.status !== RunStatus.QUEUED) {
    return;
  }

  const canceled = await redis.get(runCancelKey(run.id));
  if (canceled) {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.CANCELED,
        finishedAt: new Date()
      }
    });
    await appendRunEvent(run.id, "RunCanceledBeforeDispatch", { runId: run.id });
    return;
  }

  const activeRuns = await prisma.run.count({
    where: {
      projectId: run.projectId,
      status: RunStatus.RUNNING
    }
  });

  if (activeRuns >= PROJECT_CONCURRENCY_LIMIT) {
    await appendRunEvent(run.id, "RunDeferredConcurrency", {
      projectId: run.projectId,
      activeRuns,
      limit: PROJECT_CONCURRENCY_LIMIT
    });
    await enqueueRun(run.id);
    return;
  }

  let branchLockAcquired = false;
  if (run.runType === RunType.implementation) {
    const lockKey = runLockKey(run.projectId, run.targetBranch);
    const lockResult = await redis.set(lockKey, run.id, "EX", 7200, "NX");
    branchLockAcquired = lockResult === "OK";
    if (!branchLockAcquired) {
      await appendRunEvent(run.id, "RunDeferredBranchLock", {
        projectId: run.projectId,
        targetBranch: run.targetBranch
      });
      await enqueueRun(run.id);
      return;
    }
  }

  try {
    await ensureServiceAccount(run.project.namespace, SERVICE_ACCOUNT);

    const secrets = await prisma.projectSecret.findMany({ where: { projectId: run.projectId } });
    const mappings: ProjectProviderSecretMapping[] = secrets.map((secret) => ({
      provider: secret.provider,
      secretName: secret.k8sSecretName,
      keys: secret.keyMappings as Record<string, string>
    }));

    const secretEnv = mappings.flatMap((mapping) => materializeProviderSecretEnv(mapping));
    const modelConfig = await modelConfigForRun(run.id);

    const executionSpec: RunExecutionSpec = {
      runId: run.id,
      projectId: run.projectId,
      runType: run.runType,
      attractorDefId: run.attractorDefId,
      sourceBranch: run.sourceBranch,
      targetBranch: run.targetBranch,
      ...(run.specBundleId ? { specBundleId: run.specBundleId } : {}),
      modelConfig,
      secretsRef: secrets.map((secret) => secret.name),
      artifactPrefix: `${run.projectId}/${run.id}`
    };

    const job = buildRunnerJobManifest({
      runId: run.id,
      namespace: run.project.namespace,
      image: RUNNER_IMAGE,
      executionSpec,
      secretEnv,
      apiBaseUrl: FACTORY_API_BASE_URL,
      redisUrl: process.env.REDIS_URL ?? "redis://redis.factory-system.svc.cluster.local:6379",
      postgresUrl: POSTGRES_URL,
      minioEndpoint: MINIO_ENDPOINT,
      minioBucket: MINIO_BUCKET,
      minioAccessKey: MINIO_ACCESS_KEY,
      minioSecretKey: MINIO_SECRET_KEY,
      serviceAccountName: SERVICE_ACCOUNT
    });

    await batchApi.createNamespacedJob({ namespace: run.project.namespace, body: job });

    const updated = await prisma.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.RUNNING,
        startedAt: new Date()
      }
    });

    await appendRunEvent(run.id, "RunDispatched", {
      runId: run.id,
      status: updated.status,
      namespace: run.project.namespace,
      jobName: job.metadata?.name,
      runType: run.runType
    });
  } catch (error) {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date()
      }
    });

    await appendRunEvent(run.id, "RunDispatchFailed", {
      runId: run.id,
      message: error instanceof Error ? error.message : String(error)
    });

    if (branchLockAcquired && run.runType === RunType.implementation) {
      await redis.del(runLockKey(run.projectId, run.targetBranch));
    }
  }
}

async function runLoop(): Promise<void> {
  process.stdout.write("factory-runner-controller started\n");

  for (;;) {
    const item = await redis.brpop(runQueueKey(), POLL_TIMEOUT_SECONDS);
    if (!item) {
      continue;
    }

    const runId = item[1];
    try {
      await processRun(runId);
    } catch (error) {
      process.stderr.write(`run controller error for ${runId}: ${error}\n`);
    }
  }
}

runLoop().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
