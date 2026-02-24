import express from "express";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { App as GitHubApp } from "@octokit/app";
import { PrismaClient, RunStatus, RunType } from "@prisma/client";
import { Redis } from "ioredis";
import { getModels, getProviders } from "@mariozechner/pi-ai";
import { z } from "zod";
import {
  runCancelKey,
  runEventChannel,
  runLockKey,
  runQueueKey,
  type RunModelConfig
} from "@attractor/shared-types";
import {
  getProviderSecretSchema,
  listProviderSecretSchemas,
  materializeProviderSecretEnv,
  toProjectNamespace
} from "@attractor/shared-k8s";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const RUNNER_DEFAULT_IMAGE =
  process.env.RUNNER_IMAGE ?? "ghcr.io/wcraigjones/attractor-runner:latest";

function hasProvider(provider: string): boolean {
  return getProviders().includes(provider as never);
}

function hasModel(provider: string, modelId: string): boolean {
  if (!hasProvider(provider)) {
    return false;
  }
  return getModels(provider as never).some((model) => model.id === modelId);
}

function normalizeRunModelConfig(config: RunModelConfig): RunModelConfig {
  if (!hasProvider(config.provider)) {
    throw new Error(`Unknown provider: ${config.provider}`);
  }
  if (!hasModel(config.provider, config.modelId)) {
    throw new Error(`Unknown model ${config.modelId} for provider ${config.provider}`);
  }
  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
    throw new Error("temperature must be between 0 and 2");
  }
  if (config.maxTokens !== undefined && (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error("maxTokens must be a positive integer");
  }
  return config;
}

function getKubeApi(): CoreV1Api | null {
  if (process.env.K8S_ENABLED === "false") {
    return null;
  }
  try {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    return kc.makeApiClient(CoreV1Api);
  } catch {
    return null;
  }
}

async function ensureNamespace(name: string): Promise<void> {
  const kube = getKubeApi();
  if (!kube) {
    return;
  }

  try {
    await kube.readNamespace({ name });
  } catch {
    await kube.createNamespace({
      body: {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name }
      }
    });
  }
}

async function upsertSecret(namespace: string, secretName: string, values: Record<string, string>) {
  const kube = getKubeApi();
  if (!kube) {
    return;
  }

  const body = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName,
      namespace
    },
    type: "Opaque",
    stringData: values
  };

  try {
    const existing = await kube.readNamespacedSecret({ name: secretName, namespace });
    await kube.replaceNamespacedSecret({ name: secretName, namespace, body: { ...body, metadata: existing.metadata } as never });
  } catch {
    await kube.createNamespacedSecret({ namespace, body: body as never });
  }
}

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

function githubApp(): GitHubApp | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    return null;
  }

  return new GitHubApp({
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n")
  });
}

function sendError(res: express.Response, status: number, error: string) {
  res.status(status).json({ error });
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "factory-api", runnerImage: RUNNER_DEFAULT_IMAGE });
});

app.get("/api/models/providers", (_req, res) => {
  const providers = [...getProviders()].sort();
  res.json({ providers });
});

app.get("/api/models", (req, res) => {
  const provider = String(req.query.provider ?? "");
  if (!provider) {
    return sendError(res, 400, "provider query parameter is required");
  }
  if (!hasProvider(provider)) {
    return sendError(res, 404, `Unknown provider: ${provider}`);
  }

  const models = getModels(provider as never)
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, api: m.api }))
    .sort((a, b) => a.id.localeCompare(b.id));

  res.json({ provider, models });
});

app.get("/api/secrets/providers", (_req, res) => {
  res.json({ providers: listProviderSecretSchemas() });
});

app.get("/api/secrets/providers/:provider", (req, res) => {
  const schema = getProviderSecretSchema(req.params.provider);
  if (!schema) {
    return sendError(res, 404, `Unknown provider secret mapping: ${req.params.provider}`);
  }
  res.json(schema);
});

const createProjectSchema = z.object({
  name: z.string().min(2).max(80),
  namespace: z.string().min(2).max(63).optional()
});

async function createProjectRecord(input: { name: string; namespace?: string }) {
  const namespace = input.namespace ?? toProjectNamespace(input.name);
  await ensureNamespace(namespace);
  return prisma.project.create({
    data: {
      name: input.name,
      namespace
    }
  });
}

app.post("/api/projects", async (req, res) => {
  const input = createProjectSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const project = await createProjectRecord(input.data);

  res.status(201).json(project);
});

app.get("/api/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ projects });
});

const bootstrapSelfSchema = z.object({
  name: z.string().min(2).max(80).default("attractor-self"),
  namespace: z.string().min(2).max(63).optional(),
  repoFullName: z.string().min(3),
  defaultBranch: z.string().min(1).default("main"),
  installationId: z.string().min(1).optional(),
  attractorName: z.string().min(1).default("self-factory"),
  attractorPath: z.string().min(1).default("factory/self-bootstrap.dot")
});

app.post("/api/bootstrap/self", async (req, res) => {
  const input = bootstrapSelfSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const namespace = input.data.namespace ?? toProjectNamespace(input.data.name);
  await ensureNamespace(namespace);

  const project = await prisma.project.upsert({
    where: { namespace },
    update: {
      name: input.data.name,
      repoFullName: input.data.repoFullName,
      defaultBranch: input.data.defaultBranch,
      ...(input.data.installationId ? { githubInstallationId: input.data.installationId } : {})
    },
    create: {
      name: input.data.name,
      namespace,
      repoFullName: input.data.repoFullName,
      defaultBranch: input.data.defaultBranch,
      ...(input.data.installationId ? { githubInstallationId: input.data.installationId } : {})
    }
  });

  const attractor = await prisma.attractorDef.upsert({
    where: {
      projectId_name: {
        projectId: project.id,
        name: input.data.attractorName
      }
    },
    update: {
      repoPath: input.data.attractorPath,
      defaultRunType: "planning",
      active: true,
      description: "Self-bootstrap attractor pipeline for this repository"
    },
    create: {
      projectId: project.id,
      name: input.data.attractorName,
      repoPath: input.data.attractorPath,
      defaultRunType: "planning",
      active: true,
      description: "Self-bootstrap attractor pipeline for this repository"
    }
  });

  res.status(201).json({ project, attractor });
});

const githubConnectSchema = z.object({
  installationId: z.string().min(1),
  repoFullName: z.string().min(3),
  defaultBranch: z.string().min(1)
});

app.post("/api/projects/:projectId/repo/connect/github", async (req, res) => {
  const input = githubConnectSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const project = await prisma.project.update({
    where: { id: req.params.projectId },
    data: {
      githubInstallationId: input.data.installationId,
      repoFullName: input.data.repoFullName,
      defaultBranch: input.data.defaultBranch
    }
  });

  res.json(project);
});

const createSecretSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  k8sSecretName: z.string().min(1).optional(),
  keyMappings: z.record(z.string(), z.string()),
  values: z.record(z.string(), z.string())
});

app.post("/api/projects/:projectId/secrets", async (req, res) => {
  const input = createSecretSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project) {
    return sendError(res, 404, "project not found");
  }

  const secretName = input.data.k8sSecretName ?? `factory-secret-${input.data.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;

  const mappedSecretKeys = new Set(Object.values(input.data.keyMappings));
  const missingSecretValues = [...mappedSecretKeys].filter((secretKey) => !(secretKey in input.data.values));
  if (missingSecretValues.length > 0) {
    return sendError(
      res,
      400,
      `Secret values missing keys referenced by keyMappings: ${missingSecretValues.join(", ")}`
    );
  }

  try {
    materializeProviderSecretEnv({
      provider: input.data.provider,
      secretName,
      keys: input.data.keyMappings
    });
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : String(error));
  }

  await upsertSecret(project.namespace, secretName, input.data.values);

  const saved = await prisma.projectSecret.upsert({
    where: {
      projectId_name: {
        projectId: project.id,
        name: input.data.name
      }
    },
    update: {
      provider: input.data.provider,
      k8sSecretName: secretName,
      keyMappings: input.data.keyMappings
    },
    create: {
      projectId: project.id,
      name: input.data.name,
      provider: input.data.provider,
      k8sSecretName: secretName,
      keyMappings: input.data.keyMappings
    }
  });

  res.status(201).json(saved);
});

app.get("/api/projects/:projectId/secrets", async (req, res) => {
  const secrets = await prisma.projectSecret.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: "desc" }
  });
  res.json({ secrets });
});

const createAttractorSchema = z.object({
  name: z.string().min(1),
  repoPath: z.string().min(1),
  defaultRunType: z.enum(["planning", "implementation"]),
  description: z.string().optional(),
  active: z.boolean().optional()
});

app.post("/api/projects/:projectId/attractors", async (req, res) => {
  const input = createAttractorSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const created = await prisma.attractorDef.create({
    data: {
      projectId: req.params.projectId,
      name: input.data.name,
      repoPath: input.data.repoPath,
      defaultRunType: input.data.defaultRunType,
      description: input.data.description,
      active: input.data.active ?? true
    }
  });

  res.status(201).json(created);
});

app.get("/api/projects/:projectId/attractors", async (req, res) => {
  const attractors = await prisma.attractorDef.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: "desc" }
  });
  res.json({ attractors });
});

app.get("/api/projects/:projectId/runs", async (req, res) => {
  const runs = await prisma.run.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ runs });
});

const createRunSchema = z.object({
  projectId: z.string().min(1),
  attractorDefId: z.string().min(1),
  runType: z.enum(["planning", "implementation"]),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  specBundleId: z.string().optional(),
  modelConfig: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    reasoningLevel: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional()
  }),
  force: z.boolean().optional()
});

app.post("/api/runs", async (req, res) => {
  const input = createRunSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  try {
    normalizeRunModelConfig(input.data.modelConfig);
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : String(error));
  }

  const project = await prisma.project.findUnique({ where: { id: input.data.projectId } });
  if (!project) {
    return sendError(res, 404, "project not found");
  }

  const attractorDef = await prisma.attractorDef.findUnique({ where: { id: input.data.attractorDefId } });
  if (!attractorDef || attractorDef.projectId !== project.id) {
    return sendError(res, 404, "attractor definition not found in project");
  }
  if (!attractorDef.active) {
    return sendError(res, 409, "attractor definition is inactive");
  }

  if (input.data.runType === "planning" && input.data.specBundleId) {
    return sendError(res, 400, "planning runs must not set specBundleId");
  }

  if (input.data.runType === "implementation" && !input.data.specBundleId) {
    return sendError(res, 400, "implementation runs require specBundleId");
  }

  if (input.data.specBundleId) {
    const specBundle = await prisma.specBundle.findUnique({
      where: { id: input.data.specBundleId }
    });
    if (!specBundle) {
      return sendError(res, 404, "spec bundle not found");
    }
    if (specBundle.schemaVersion !== "v1") {
      return sendError(res, 409, `unsupported spec bundle schema version: ${specBundle.schemaVersion}`);
    }
  }

  if (input.data.runType === "implementation" && !input.data.force) {
    const collision = await prisma.run.findFirst({
      where: {
        projectId: project.id,
        runType: RunType.implementation,
        targetBranch: input.data.targetBranch,
        status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] }
      }
    });

    if (collision) {
      return sendError(
        res,
        409,
        `Branch collision: run ${collision.id} is already active on ${input.data.targetBranch}`
      );
    }
  }

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      attractorDefId: attractorDef.id,
      runType: input.data.runType,
      sourceBranch: input.data.sourceBranch,
      targetBranch: input.data.targetBranch,
      status: RunStatus.QUEUED,
      specBundleId: input.data.specBundleId
    }
  });

  await appendRunEvent(run.id, "RunQueued", {
    runId: run.id,
    runType: run.runType,
    projectId: run.projectId,
    targetBranch: run.targetBranch,
    modelConfig: input.data.modelConfig,
    runnerImage: RUNNER_DEFAULT_IMAGE
  });

  await redis.lpush(runQueueKey(), run.id);

  res.status(201).json({ runId: run.id, status: run.status });
});

const selfIterateSchema = z.object({
  attractorDefId: z.string().min(1),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  modelConfig: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    reasoningLevel: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional()
  }),
  force: z.boolean().optional()
});

app.post("/api/projects/:projectId/self-iterate", async (req, res) => {
  const input = selfIterateSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  try {
    normalizeRunModelConfig(input.data.modelConfig);
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : String(error));
  }

  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project) {
    return sendError(res, 404, "project not found");
  }

  const attractorDef = await prisma.attractorDef.findUnique({ where: { id: input.data.attractorDefId } });
  if (!attractorDef || attractorDef.projectId !== project.id) {
    return sendError(res, 404, "attractor definition not found in project");
  }

  const latestPlanningRun = await prisma.run.findFirst({
    where: {
      projectId: project.id,
      runType: RunType.planning,
      status: RunStatus.SUCCEEDED,
      specBundleId: { not: null }
    },
    orderBy: {
      finishedAt: "desc"
    }
  });

  if (!latestPlanningRun?.specBundleId) {
    return sendError(res, 409, "no successful planning run with a spec bundle is available");
  }

  if (!input.data.force) {
    const collision = await prisma.run.findFirst({
      where: {
        projectId: project.id,
        runType: RunType.implementation,
        targetBranch: input.data.targetBranch,
        status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] }
      }
    });

    if (collision) {
      return sendError(
        res,
        409,
        `Branch collision: run ${collision.id} is already active on ${input.data.targetBranch}`
      );
    }
  }

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      attractorDefId: attractorDef.id,
      runType: RunType.implementation,
      sourceBranch: input.data.sourceBranch,
      targetBranch: input.data.targetBranch,
      status: RunStatus.QUEUED,
      specBundleId: latestPlanningRun.specBundleId
    }
  });

  await appendRunEvent(run.id, "RunQueued", {
    runId: run.id,
    runType: run.runType,
    projectId: run.projectId,
    targetBranch: run.targetBranch,
    modelConfig: input.data.modelConfig,
    runnerImage: RUNNER_DEFAULT_IMAGE,
    sourcePlanningRunId: latestPlanningRun.id,
    sourceSpecBundleId: latestPlanningRun.specBundleId
  });

  await redis.lpush(runQueueKey(), run.id);

  res.status(201).json({
    runId: run.id,
    status: run.status,
    sourcePlanningRunId: latestPlanningRun.id,
    sourceSpecBundleId: latestPlanningRun.specBundleId
  });
});

app.get("/api/runs/:runId", async (req, res) => {
  const run = await prisma.run.findUnique({
    where: { id: req.params.runId },
    include: {
      events: {
        orderBy: { ts: "asc" },
        take: 200
      }
    }
  });
  if (!run) {
    return sendError(res, 404, "run not found");
  }
  res.json(run);
});

app.get("/api/runs/:runId/events", async (req, res) => {
  const run = await prisma.run.findUnique({ where: { id: req.params.runId } });
  if (!run) {
    return sendError(res, 404, "run not found");
  }

  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();

  const initialEvents = await prisma.runEvent.findMany({
    where: { runId: run.id },
    orderBy: { ts: "asc" },
    take: 200
  });

  for (const event of initialEvents) {
    res.write(`data: ${JSON.stringify({
      id: event.id,
      runId: event.runId,
      ts: event.ts.toISOString(),
      type: event.type,
      payload: event.payload
    })}\n\n`);
  }

  const sub = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  await sub.subscribe(runEventChannel(run.id));
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 25000);

  sub.on("message", (_channel: string, message: string) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on("close", async () => {
    clearInterval(heartbeat);
    await sub.unsubscribe(runEventChannel(run.id));
    sub.disconnect();
  });
});

app.get("/api/runs/:runId/artifacts", async (req, res) => {
  const artifacts = await prisma.artifact.findMany({
    where: { runId: req.params.runId },
    orderBy: { createdAt: "asc" }
  });

  const specBundle = await prisma.specBundle.findFirst({ where: { runId: req.params.runId } });
  res.json({ artifacts, specBundle });
});

app.post("/api/runs/:runId/cancel", async (req, res) => {
  const run = await prisma.run.findUnique({ where: { id: req.params.runId } });
  if (!run) {
    return sendError(res, 404, "run not found");
  }

  if (run.status !== RunStatus.QUEUED && run.status !== RunStatus.RUNNING) {
    return sendError(res, 409, `run is already terminal (${run.status})`);
  }

  const updated = await prisma.run.update({
    where: { id: run.id },
    data: {
      status: RunStatus.CANCELED,
      finishedAt: new Date()
    }
  });

  await redis.set(runCancelKey(run.id), "1", "EX", 7200);
  await appendRunEvent(run.id, "RunCanceled", { runId: run.id });

  if (run.runType === RunType.implementation) {
    await redis.del(runLockKey(run.projectId, run.targetBranch));
  }

  res.json({ runId: updated.id, status: updated.status });
});

app.get("/api/github/app/start", (req, res) => {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) {
    return sendError(res, 500, "GITHUB_APP_SLUG is not configured");
  }

  const projectId = String(req.query.projectId ?? "");
  const state = encodeURIComponent(projectId || "none");
  const installationUrl = `https://github.com/apps/${slug}/installations/new?state=${state}`;
  res.json({ installationUrl });
});

app.get("/api/github/app/callback", async (req, res) => {
  const installationId = String(req.query.installation_id ?? "");
  const projectId = String(req.query.state ?? "");

  if (!installationId || !projectId) {
    return sendError(res, 400, "installation_id and state(projectId) are required");
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      githubInstallationId: installationId
    }
  });

  res.json({ projectId, installationId, linked: true });
});

app.get("/api/projects/:projectId/github/repos", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project || !project.githubInstallationId) {
    return sendError(res, 404, "project/github installation not found");
  }

  const ghApp = githubApp();
  if (!ghApp) {
    return sendError(res, 500, "GitHub App credentials are not configured");
  }

  const octokit = await ghApp.getInstallationOctokit(Number(project.githubInstallationId));
  const response = await octokit.request("GET /installation/repositories");
  const repos = response.data.repositories.map((repo: { id: number; full_name: string; default_branch: string; private: boolean }) => ({
    id: repo.id,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private
  }));

  res.json({ repos });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

app.listen(PORT, HOST, () => {
  process.stdout.write(`factory-api listening on http://${HOST}:${PORT}\n`);
});
