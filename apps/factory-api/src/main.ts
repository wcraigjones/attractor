import express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { App as GitHubApp } from "@octokit/app";
import {
  AttractorScope,
  EnvironmentKind,
  PrismaClient,
  ReviewDecision,
  RunQuestionStatus,
  RunStatus,
  RunType
} from "@prisma/client";
import { Redis } from "ioredis";
import { getModels, getProviders } from "@mariozechner/pi-ai";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  type EnvironmentResources,
  type RunExecutionEnvironment,
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
import { clampPreviewBytes, isProbablyText, isTextByMetadata } from "./artifact-preview.js";
import {
  type ReviewCriticalSection,
  defaultReviewChecklistValue,
  extractCriticalSectionsFromDiff,
  rankReviewArtifacts,
  reviewChecklistTemplate,
  reviewSlaStatus,
  RUN_REVIEW_FRAMEWORK_VERSION,
  summarizeImplementationNote
} from "./run-review.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const RUNNER_DEFAULT_IMAGE =
  process.env.RUNNER_IMAGE ?? "ghcr.io/wcraigjones/attractor-factory-runner:latest";
const RUNNER_DEFAULT_SERVICE_ACCOUNT = process.env.RUNNER_SERVICE_ACCOUNT ?? "factory-runner";
const DEFAULT_ENVIRONMENT_NAME = process.env.DEFAULT_ENVIRONMENT_NAME ?? "default-k8s";
const GLOBAL_SECRET_NAMESPACE =
  process.env.GLOBAL_SECRET_NAMESPACE ?? process.env.FACTORY_SYSTEM_NAMESPACE ?? "factory-system";
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "factory-artifacts";
const digestPinnedImagePattern = /@sha256:[a-f0-9]{64}$/;
const environmentResourcesSchema = z.object({
  requests: z
    .object({
      cpu: z.string().min(1).optional(),
      memory: z.string().min(1).optional()
    })
    .optional(),
  limits: z
    .object({
      cpu: z.string().min(1).optional(),
      memory: z.string().min(1).optional()
    })
    .optional()
});

const minioClient = new S3Client({
  region: "us-east-1",
  endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? "minioadmin"
  }
});

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  const maybeTransform = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybeTransform?.transformToByteArray === "function") {
    const bytes = await maybeTransform.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 object body stream");
}

async function getArtifactByRun(runId: string, artifactId: string) {
  return prisma.artifact.findFirst({
    where: {
      id: artifactId,
      runId
    }
  });
}

async function getObjectText(key: string): Promise<string | null> {
  try {
    const output = await minioClient.send(
      new GetObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key
      })
    );
    if (!output.Body) {
      return null;
    }
    const bytes = await bodyToBuffer(output.Body);
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}

let attractorBucketReady = false;

async function ensureAttractorBucket(): Promise<void> {
  if (attractorBucketReady) {
    return;
  }

  try {
    await minioClient.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET }));
    attractorBucketReady = true;
    return;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (error as { name?: string })?.name;
    if (status === 404 || name === "NotFound" || name === "NoSuchBucket") {
      await minioClient.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET }));
      attractorBucketReady = true;
      return;
    }
    throw error;
  }
}

function sanitizeAttractorName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "attractor";
}

function digestText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function attractorObjectPath(args: {
  scope: "global" | "project";
  name: string;
  version: number;
  projectId?: string;
}): string {
  const safeName = sanitizeAttractorName(args.name);
  if (args.scope === "global") {
    return `attractors/global/${safeName}/v${args.version}.dot`;
  }
  if (!args.projectId) {
    throw new Error("projectId is required for project attractor object paths");
  }
  return `attractors/projects/${args.projectId}/${safeName}/v${args.version}.dot`;
}

async function putAttractorContent(objectPath: string, content: string): Promise<void> {
  await ensureAttractorBucket();
  await minioClient.send(
    new PutObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: objectPath,
      Body: content,
      ContentType: "text/vnd.graphviz"
    })
  );
}

function toNullableText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStoredChecklist(raw: unknown) {
  const base = defaultReviewChecklistValue();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  const parsed = raw as Record<string, unknown>;
  return {
    summaryReviewed: parsed.summaryReviewed === true,
    criticalCodeReviewed: parsed.criticalCodeReviewed === true,
    artifactsReviewed: parsed.artifactsReviewed === true,
    functionalValidationReviewed: parsed.functionalValidationReviewed === true
  };
}

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

function isDigestPinnedImage(value: string): boolean {
  return digestPinnedImagePattern.test(value);
}

function validateDigestPinnedImage(value: string): string {
  if (!isDigestPinnedImage(value)) {
    throw new Error("runnerImage must be pinned by digest (example: ghcr.io/org/image@sha256:...)");
  }
  return value;
}

function normalizeEnvironmentResources(value: unknown): EnvironmentResources | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = environmentResourcesSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function toRunExecutionEnvironment(environment: {
  id: string;
  name: string;
  kind: EnvironmentKind;
  runnerImage: string;
  serviceAccountName: string | null;
  resourcesJson: unknown;
}): RunExecutionEnvironment {
  const resources = normalizeEnvironmentResources(environment.resourcesJson);
  return {
    id: environment.id,
    name: environment.name,
    kind: environment.kind,
    runnerImage: environment.runnerImage,
    ...(environment.serviceAccountName ? { serviceAccountName: environment.serviceAccountName } : {}),
    ...(resources ? { resources } : {})
  };
}

async function ensureDefaultEnvironment() {
  const existing = await prisma.environment.findUnique({
    where: { name: DEFAULT_ENVIRONMENT_NAME }
  });
  if (existing) {
    return existing;
  }

  return prisma.environment.create({
    data: {
      name: DEFAULT_ENVIRONMENT_NAME,
      kind: EnvironmentKind.KUBERNETES_JOB,
      runnerImage: RUNNER_DEFAULT_IMAGE,
      serviceAccountName: RUNNER_DEFAULT_SERVICE_ACCOUNT,
      active: true
    }
  });
}

async function resolveProjectDefaultEnvironment(projectId: string, explicitEnvironmentId?: string) {
  if (explicitEnvironmentId) {
    const environment = await prisma.environment.findUnique({
      where: { id: explicitEnvironmentId }
    });
    if (!environment) {
      throw new Error("environment not found");
    }
    if (!environment.active) {
      throw new Error(`environment ${environment.name} is inactive`);
    }
    return environment;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { defaultEnvironmentId: true }
  });
  if (!project) {
    throw new Error("project not found");
  }

  if (project.defaultEnvironmentId) {
    const environment = await prisma.environment.findUnique({
      where: { id: project.defaultEnvironmentId }
    });
    if (!environment) {
      throw new Error("project default environment no longer exists");
    }
    if (!environment.active) {
      throw new Error(`project default environment ${environment.name} is inactive`);
    }
    return environment;
  }

  const fallback = await ensureDefaultEnvironment();
  await prisma.project.update({
    where: { id: projectId },
    data: { defaultEnvironmentId: fallback.id }
  });
  return fallback;
}

async function resolveRunEnvironment(input: {
  projectId: string;
  explicitEnvironmentId?: string;
}): Promise<{ id: string; snapshot: RunExecutionEnvironment }> {
  const environment = await resolveProjectDefaultEnvironment(
    input.projectId,
    input.explicitEnvironmentId
  );

  return {
    id: environment.id,
    snapshot: toRunExecutionEnvironment(environment)
  };
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

function toSecretName(prefix: string, name: string): string {
  return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
}

function decodeSecretData(data: Record<string, string> | undefined): Record<string, string> {
  if (!data) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, Buffer.from(value, "base64").toString("utf8")])
  );
}

async function readSecretValues(namespace: string, secretName: string): Promise<Record<string, string>> {
  const kube = getKubeApi();
  if (!kube) {
    return {};
  }
  const existing = await kube.readNamespacedSecret({ name: secretName, namespace });
  return decodeSecretData(existing.data as Record<string, string> | undefined);
}

async function syncGlobalSecretsToNamespace(namespace: string): Promise<void> {
  const globals = await prisma.globalSecret.findMany();
  for (const secret of globals) {
    try {
      const values = await readSecretValues(GLOBAL_SECRET_NAMESPACE, secret.k8sSecretName);
      if (Object.keys(values).length === 0) {
        continue;
      }
      await upsertSecret(namespace, secret.k8sSecretName, values);
    } catch (error) {
      process.stderr.write(
        `global secret sync skipped for ${secret.name} in namespace ${namespace}: ${error}\n`
      );
    }
  }
}

async function propagateGlobalSecretToAllProjects(secretName: string, values: Record<string, string>) {
  const projects = await prisma.project.findMany({ select: { namespace: true } });
  for (const project of projects) {
    await upsertSecret(project.namespace, secretName, values);
  }
}

async function upsertGlobalAttractorForProject(
  projectId: string,
  attractor: {
    name: string;
    repoPath: string | null;
    contentPath: string | null;
    contentVersion: number;
    defaultRunType: RunType;
    description: string | null;
    active: boolean;
  }
): Promise<void> {
  await prisma.attractorDef.upsert({
    where: {
      projectId_name_scope: {
        projectId,
        name: attractor.name,
        scope: AttractorScope.GLOBAL
      }
    },
    update: {
      repoPath: attractor.repoPath,
      contentPath: attractor.contentPath,
      contentVersion: attractor.contentVersion,
      defaultRunType: attractor.defaultRunType,
      description: attractor.description,
      active: attractor.active
    },
    create: {
      projectId,
      scope: AttractorScope.GLOBAL,
      name: attractor.name,
      repoPath: attractor.repoPath,
      contentPath: attractor.contentPath,
      contentVersion: attractor.contentVersion,
      defaultRunType: attractor.defaultRunType,
      description: attractor.description,
      active: attractor.active
    }
  });
}

async function syncGlobalAttractorsToProject(projectId: string): Promise<void> {
  const globals = await prisma.globalAttractor.findMany();
  for (const attractor of globals) {
    await upsertGlobalAttractorForProject(projectId, attractor);
  }
}

async function propagateGlobalAttractorToAllProjects(attractor: {
  name: string;
  repoPath: string | null;
  contentPath: string | null;
  contentVersion: number;
  defaultRunType: RunType;
  description: string | null;
  active: boolean;
}): Promise<void> {
  const projects = await prisma.project.findMany({ select: { id: true } });
  for (const project of projects) {
    await upsertGlobalAttractorForProject(project.id, attractor);
  }
}

async function hasEffectiveProviderSecret(projectId: string, provider: string): Promise<boolean> {
  const [projectSecret, globalSecret] = await Promise.all([
    prisma.projectSecret.findFirst({
      where: {
        projectId,
        provider
      }
    }),
    prisma.globalSecret.findFirst({
      where: {
        provider
      }
    })
  ]);

  return !!projectSecret || !!globalSecret;
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

const createEnvironmentSchema = z.object({
  name: z.string().min(2).max(80),
  kind: z.enum(["KUBERNETES_JOB"]).default("KUBERNETES_JOB"),
  runnerImage: z.string().min(1),
  serviceAccountName: z.string().min(1).optional(),
  resourcesJson: environmentResourcesSchema.optional(),
  active: z.boolean().optional()
});

const patchEnvironmentSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    runnerImage: z.string().min(1).optional(),
    serviceAccountName: z.string().min(1).nullable().optional(),
    resourcesJson: environmentResourcesSchema.optional(),
    active: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required"
  });

app.get("/api/environments", async (_req, res) => {
  await ensureDefaultEnvironment();
  const environments = await prisma.environment.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json({ environments });
});

app.post("/api/environments", async (req, res) => {
  const input = createEnvironmentSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  try {
    validateDigestPinnedImage(input.data.runnerImage);
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : String(error));
  }

  try {
    const environment = await prisma.environment.create({
      data: {
        name: input.data.name,
        kind: input.data.kind,
        runnerImage: input.data.runnerImage,
        serviceAccountName: input.data.serviceAccountName,
        resourcesJson: input.data.resourcesJson,
        active: input.data.active ?? true
      }
    });
    res.status(201).json(environment);
  } catch (error) {
    return sendError(res, 409, error instanceof Error ? error.message : String(error));
  }
});

app.patch("/api/environments/:environmentId", async (req, res) => {
  const input = patchEnvironmentSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  if (input.data.runnerImage) {
    try {
      validateDigestPinnedImage(input.data.runnerImage);
    } catch (error) {
      return sendError(res, 400, error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const updated = await prisma.environment.update({
      where: { id: req.params.environmentId },
      data: {
        ...(input.data.name !== undefined ? { name: input.data.name } : {}),
        ...(input.data.runnerImage !== undefined ? { runnerImage: input.data.runnerImage } : {}),
        ...(input.data.serviceAccountName !== undefined
          ? { serviceAccountName: input.data.serviceAccountName }
          : {}),
        ...(input.data.resourcesJson !== undefined ? { resourcesJson: input.data.resourcesJson } : {}),
        ...(input.data.active !== undefined ? { active: input.data.active } : {})
      }
    });
    res.json(updated);
  } catch (error) {
    return sendError(res, 404, error instanceof Error ? error.message : String(error));
  }
});

const createProjectSchema = z.object({
  name: z.string().min(2).max(80),
  namespace: z.string().min(2).max(63).optional(),
  defaultEnvironmentId: z.string().min(1).optional()
});

async function createProjectRecord(input: {
  name: string;
  namespace?: string;
  defaultEnvironmentId?: string;
}) {
  const namespace = input.namespace ?? toProjectNamespace(input.name);
  const defaultEnvironment = input.defaultEnvironmentId
    ? await prisma.environment.findUnique({
        where: { id: input.defaultEnvironmentId }
      })
    : await ensureDefaultEnvironment();
  if (!defaultEnvironment) {
    throw new Error("default environment not found");
  }
  if (!defaultEnvironment.active) {
    throw new Error(`environment ${defaultEnvironment.name} is inactive`);
  }
  await ensureNamespace(namespace);
  const project = await prisma.project.create({
    data: {
      name: input.name,
      namespace,
      defaultEnvironmentId: defaultEnvironment.id
    }
  });
  await syncGlobalSecretsToNamespace(namespace);
  await syncGlobalAttractorsToProject(project.id);
  return project;
}

app.post("/api/projects", async (req, res) => {
  const input = createProjectSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  let project;
  try {
    project = await createProjectRecord(input.data);
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : String(error));
  }

  res.status(201).json(project);
});

app.get("/api/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ projects });
});

const projectDefaultEnvironmentSchema = z.object({
  environmentId: z.string().min(1)
});

app.post("/api/projects/:projectId/environment", async (req, res) => {
  const input = projectDefaultEnvironmentSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project) {
    return sendError(res, 404, "project not found");
  }

  const environment = await prisma.environment.findUnique({
    where: { id: input.data.environmentId }
  });
  if (!environment) {
    return sendError(res, 404, "environment not found");
  }
  if (!environment.active) {
    return sendError(res, 409, `environment ${environment.name} is inactive`);
  }

  const updatedProject = await prisma.project.update({
    where: { id: project.id },
    data: { defaultEnvironmentId: environment.id }
  });

  res.json(updatedProject);
});

const bootstrapSelfSchema = z.object({
  name: z.string().min(2).max(80).default("attractor-self"),
  namespace: z.string().min(2).max(63).optional(),
  defaultEnvironmentId: z.string().min(1).optional(),
  repoFullName: z.string().min(3),
  defaultBranch: z.string().min(1).default("main"),
  installationId: z.string().min(1).optional(),
  attractorName: z.string().min(1).default("self-factory"),
  attractorPath: z.string().min(1).default("factory/self-bootstrap.dot"),
  attractorContent: z.string().min(1).optional()
});

app.post("/api/bootstrap/self", async (req, res) => {
  const input = bootstrapSelfSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const namespace = input.data.namespace ?? toProjectNamespace(input.data.name);
  await ensureNamespace(namespace);

  let explicitEnvironmentId: string | undefined;
  if (input.data.defaultEnvironmentId) {
    const explicitEnvironment = await prisma.environment.findUnique({
      where: { id: input.data.defaultEnvironmentId }
    });
    if (!explicitEnvironment) {
      return sendError(res, 404, "default environment not found");
    }
    if (!explicitEnvironment.active) {
      return sendError(res, 409, `environment ${explicitEnvironment.name} is inactive`);
    }
    explicitEnvironmentId = explicitEnvironment.id;
  } else {
    explicitEnvironmentId = (await ensureDefaultEnvironment()).id;
  }

  const project = await prisma.project.upsert({
    where: { namespace },
    update: {
      name: input.data.name,
      repoFullName: input.data.repoFullName,
      defaultBranch: input.data.defaultBranch,
      ...(input.data.defaultEnvironmentId ? { defaultEnvironmentId: explicitEnvironmentId } : {}),
      ...(input.data.installationId ? { githubInstallationId: input.data.installationId } : {})
    },
    create: {
      name: input.data.name,
      namespace,
      repoFullName: input.data.repoFullName,
      defaultBranch: input.data.defaultBranch,
      defaultEnvironmentId: explicitEnvironmentId,
      ...(input.data.installationId ? { githubInstallationId: input.data.installationId } : {})
    }
  });

  let effectiveProject = project;
  if (!project.defaultEnvironmentId) {
    effectiveProject = await prisma.project.update({
      where: { id: project.id },
      data: { defaultEnvironmentId: explicitEnvironmentId }
    });
  }

  await syncGlobalSecretsToNamespace(namespace);
  await syncGlobalAttractorsToProject(effectiveProject.id);

  let bootstrapAttractorContent = toNullableText(input.data.attractorContent);
  if (!bootstrapAttractorContent) {
    const absolutePath = join(process.cwd(), input.data.attractorPath);
    try {
      bootstrapAttractorContent = readFileSync(absolutePath, "utf8");
    } catch (error) {
      return sendError(
        res,
        400,
        `unable to load bootstrap attractor content from ${input.data.attractorPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const existingBootstrapAttractor = await prisma.attractorDef.findUnique({
    where: {
      projectId_name_scope: {
        projectId: effectiveProject.id,
        name: input.data.attractorName,
        scope: AttractorScope.PROJECT
      }
    }
  });
  const currentVersion = existingBootstrapAttractor?.contentVersion ?? 0;
  const latestVersion =
    existingBootstrapAttractor && currentVersion > 0
      ? await prisma.attractorDefVersion.findUnique({
          where: {
            attractorDefId_version: {
              attractorDefId: existingBootstrapAttractor.id,
              version: currentVersion
            }
          }
        })
      : null;
  const contentSha256 = digestText(bootstrapAttractorContent);
  const needsNewVersion =
    !existingBootstrapAttractor ||
    !existingBootstrapAttractor.contentPath ||
    currentVersion <= 0 ||
    latestVersion?.contentSha256 !== contentSha256;

  let contentPath = existingBootstrapAttractor?.contentPath ?? null;
  let contentVersion = currentVersion;
  if (needsNewVersion) {
    contentVersion = Math.max(currentVersion, 0) + 1;
    contentPath = attractorObjectPath({
      scope: "project",
      projectId: effectiveProject.id,
      name: input.data.attractorName,
      version: contentVersion
    });
    await putAttractorContent(contentPath, bootstrapAttractorContent);
  }

  const attractor = await prisma.attractorDef.upsert({
    where: {
      projectId_name_scope: {
        projectId: effectiveProject.id,
        name: input.data.attractorName,
        scope: AttractorScope.PROJECT
      }
    },
    update: {
      repoPath: input.data.attractorPath,
      contentPath,
      contentVersion,
      defaultRunType: "planning",
      active: true,
      description: "Self-bootstrap attractor pipeline for this repository"
    },
    create: {
      projectId: effectiveProject.id,
      scope: AttractorScope.PROJECT,
      name: input.data.attractorName,
      repoPath: input.data.attractorPath,
      contentPath,
      contentVersion,
      defaultRunType: "planning",
      active: true,
      description: "Self-bootstrap attractor pipeline for this repository"
    }
  });

  if (needsNewVersion && contentPath) {
    await prisma.attractorDefVersion.create({
      data: {
        attractorDefId: attractor.id,
        version: contentVersion,
        contentPath,
        contentSha256,
        sizeBytes: Buffer.byteLength(bootstrapAttractorContent, "utf8")
      }
    });
  }

  res.status(201).json({ project: effectiveProject, attractor });
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

const ARBITRARY_SECRET_PROVIDER = "__arbitrary__";

function normalizeSecretProvider(provider: string | undefined): string {
  const normalized = (provider ?? "").trim();
  return normalized.length > 0 ? normalized : ARBITRARY_SECRET_PROVIDER;
}

function normalizeSecretPayload(input: {
  provider?: string;
  keyMappings: Record<string, string>;
  values: Record<string, string>;
}): { provider: string; keyMappings: Record<string, string>; values: Record<string, string> } {
  const provider = normalizeSecretProvider(input.provider);
  const values = input.values;
  const keyMappings =
    Object.keys(input.keyMappings).length > 0
      ? input.keyMappings
      : Object.fromEntries(Object.keys(values).map((key) => [key, key]));
  return { provider, keyMappings, values };
}

const createSecretSchema = z.object({
  name: z.string().min(1),
  provider: z.string().optional(),
  k8sSecretName: z.string().min(1).optional(),
  keyMappings: z.record(z.string(), z.string()).default({}),
  values: z.record(z.string(), z.string()).refine((values) => Object.keys(values).length > 0, {
    message: "values must include at least one key"
  })
});

app.post("/api/secrets/global", async (req, res) => {
  const input = createSecretSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const normalized = normalizeSecretPayload(input.data);
  const secretName = input.data.k8sSecretName ?? toSecretName("factory-global", input.data.name);
  const mappedSecretKeys = new Set(Object.values(normalized.keyMappings));
  const missingSecretValues = [...mappedSecretKeys].filter((secretKey) => !(secretKey in normalized.values));
  if (missingSecretValues.length > 0) {
    return sendError(
      res,
      400,
      `Secret values missing keys referenced by keyMappings: ${missingSecretValues.join(", ")}`
    );
  }

  if (getProviderSecretSchema(normalized.provider)) {
    try {
      materializeProviderSecretEnv({
        provider: normalized.provider,
        secretName,
        keys: normalized.keyMappings
      });
    } catch (error) {
      return sendError(res, 400, error instanceof Error ? error.message : String(error));
    }
  }

  await upsertSecret(GLOBAL_SECRET_NAMESPACE, secretName, normalized.values);
  await propagateGlobalSecretToAllProjects(secretName, normalized.values);

  const saved = await prisma.globalSecret.upsert({
    where: {
      name: input.data.name
    },
    update: {
      provider: normalized.provider,
      k8sSecretName: secretName,
      keyMappings: normalized.keyMappings
    },
    create: {
      name: input.data.name,
      provider: normalized.provider,
      k8sSecretName: secretName,
      keyMappings: normalized.keyMappings
    }
  });

  res.status(201).json(saved);
});

app.get("/api/secrets/global", async (_req, res) => {
  const secrets = await prisma.globalSecret.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json({ secrets });
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

  const normalized = normalizeSecretPayload(input.data);
  const secretName = input.data.k8sSecretName ?? toSecretName("factory-secret", input.data.name);

  const mappedSecretKeys = new Set(Object.values(normalized.keyMappings));
  const missingSecretValues = [...mappedSecretKeys].filter((secretKey) => !(secretKey in normalized.values));
  if (missingSecretValues.length > 0) {
    return sendError(
      res,
      400,
      `Secret values missing keys referenced by keyMappings: ${missingSecretValues.join(", ")}`
    );
  }

  if (getProviderSecretSchema(normalized.provider)) {
    try {
      materializeProviderSecretEnv({
        provider: normalized.provider,
        secretName,
        keys: normalized.keyMappings
      });
    } catch (error) {
      return sendError(res, 400, error instanceof Error ? error.message : String(error));
    }
  }

  await upsertSecret(project.namespace, secretName, normalized.values);

  const saved = await prisma.projectSecret.upsert({
    where: {
      projectId_name: {
        projectId: project.id,
        name: input.data.name
      }
    },
    update: {
      provider: normalized.provider,
      k8sSecretName: secretName,
      keyMappings: normalized.keyMappings
    },
    create: {
      projectId: project.id,
      name: input.data.name,
      provider: normalized.provider,
      k8sSecretName: secretName,
      keyMappings: normalized.keyMappings
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
  content: z.string().min(1),
  repoPath: z.string().optional(),
  defaultRunType: z.enum(["planning", "implementation", "task"]),
  description: z.string().optional(),
  active: z.boolean().optional()
});

app.post("/api/attractors/global", async (req, res) => {
  const input = createAttractorSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const content = input.data.content.trim();
  if (content.length === 0) {
    return sendError(res, 400, "attractor content must not be empty");
  }

  const existing = await prisma.globalAttractor.findUnique({
    where: { name: input.data.name }
  });
  const currentVersion = existing?.contentVersion ?? 0;
  const latestVersion =
    existing && currentVersion > 0
      ? await prisma.globalAttractorVersion.findUnique({
          where: {
            globalAttractorId_version: {
              globalAttractorId: existing.id,
              version: currentVersion
            }
          }
        })
      : null;
  const contentSha256 = digestText(content);
  const needsNewVersion =
    !existing || !existing.contentPath || currentVersion <= 0 || latestVersion?.contentSha256 !== contentSha256;

  let contentPath = existing?.contentPath ?? null;
  let contentVersion = currentVersion;
  if (needsNewVersion) {
    contentVersion = Math.max(currentVersion, 0) + 1;
    contentPath = attractorObjectPath({
      scope: "global",
      name: input.data.name,
      version: contentVersion
    });
    await putAttractorContent(contentPath, content);
  }

  const saved = await prisma.globalAttractor.upsert({
    where: {
      name: input.data.name
    },
    update: {
      repoPath: toNullableText(input.data.repoPath),
      contentPath,
      contentVersion,
      defaultRunType: input.data.defaultRunType,
      description: input.data.description,
      ...(input.data.active !== undefined ? { active: input.data.active } : {})
    },
    create: {
      name: input.data.name,
      repoPath: toNullableText(input.data.repoPath),
      contentPath,
      contentVersion,
      defaultRunType: input.data.defaultRunType,
      description: input.data.description,
      active: input.data.active ?? true
    }
  });

  if (needsNewVersion && contentPath) {
    await prisma.globalAttractorVersion.create({
      data: {
        globalAttractorId: saved.id,
        version: contentVersion,
        contentPath,
        contentSha256,
        sizeBytes: Buffer.byteLength(content, "utf8")
      }
    });
  }

  await propagateGlobalAttractorToAllProjects(saved);

  res.status(201).json(saved);
});

app.get("/api/attractors/global", async (_req, res) => {
  const attractors = await prisma.globalAttractor.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json({ attractors });
});

app.post("/api/projects/:projectId/attractors", async (req, res) => {
  const input = createAttractorSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const content = input.data.content.trim();
  if (content.length === 0) {
    return sendError(res, 400, "attractor content must not be empty");
  }

  const existing = await prisma.attractorDef.findUnique({
    where: {
      projectId_name_scope: {
        projectId: req.params.projectId,
        name: input.data.name,
        scope: AttractorScope.PROJECT
      }
    }
  });
  const currentVersion = existing?.contentVersion ?? 0;
  const latestVersion =
    existing && currentVersion > 0
      ? await prisma.attractorDefVersion.findUnique({
          where: {
            attractorDefId_version: {
              attractorDefId: existing.id,
              version: currentVersion
            }
          }
        })
      : null;
  const contentSha256 = digestText(content);
  const needsNewVersion =
    !existing || !existing.contentPath || currentVersion <= 0 || latestVersion?.contentSha256 !== contentSha256;

  let contentPath = existing?.contentPath ?? null;
  let contentVersion = currentVersion;
  if (needsNewVersion) {
    contentVersion = Math.max(currentVersion, 0) + 1;
    contentPath = attractorObjectPath({
      scope: "project",
      projectId: req.params.projectId,
      name: input.data.name,
      version: contentVersion
    });
    await putAttractorContent(contentPath, content);
  }

  const saved = await prisma.attractorDef.upsert({
    where: {
      projectId_name_scope: {
        projectId: req.params.projectId,
        name: input.data.name,
        scope: AttractorScope.PROJECT
      }
    },
    update: {
      repoPath: toNullableText(input.data.repoPath),
      contentPath,
      contentVersion,
      defaultRunType: input.data.defaultRunType,
      description: input.data.description,
      ...(input.data.active !== undefined ? { active: input.data.active } : {})
    },
    create: {
      projectId: req.params.projectId,
      scope: AttractorScope.PROJECT,
      name: input.data.name,
      repoPath: toNullableText(input.data.repoPath),
      contentPath,
      contentVersion,
      defaultRunType: input.data.defaultRunType,
      description: input.data.description,
      active: input.data.active ?? true
    }
  });

  if (needsNewVersion && contentPath) {
    await prisma.attractorDefVersion.create({
      data: {
        attractorDefId: saved.id,
        version: contentVersion,
        contentPath,
        contentSha256,
        sizeBytes: Buffer.byteLength(content, "utf8")
      }
    });
  }

  res.status(201).json(saved);
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
  environmentId: z.string().min(1).optional(),
  runType: z.enum(["planning", "implementation", "task"]),
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

  const providerSecretExists = await hasEffectiveProviderSecret(project.id, input.data.modelConfig.provider);
  if (!providerSecretExists) {
    return sendError(
      res,
      409,
      `Missing provider secret for ${input.data.modelConfig.provider}. Configure it in Project Secret or Global Secret UI first.`
    );
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

  if (input.data.runType === "task" && input.data.specBundleId) {
    return sendError(res, 400, "task runs must not set specBundleId");
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

  let resolvedEnvironment;
  try {
    resolvedEnvironment = await resolveRunEnvironment({
      projectId: project.id,
      explicitEnvironmentId: input.data.environmentId
    });
  } catch (error) {
    return sendError(res, 409, error instanceof Error ? error.message : String(error));
  }

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      attractorDefId: attractorDef.id,
      environmentId: resolvedEnvironment.id,
      environmentSnapshot: resolvedEnvironment.snapshot as never,
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
    environment: resolvedEnvironment.snapshot,
    runnerImage: resolvedEnvironment.snapshot.runnerImage
  });

  await redis.lpush(runQueueKey(), run.id);

  res.status(201).json({ runId: run.id, status: run.status });
});

const selfIterateSchema = z.object({
  attractorDefId: z.string().min(1),
  environmentId: z.string().min(1).optional(),
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

  const providerSecretExists = await hasEffectiveProviderSecret(project.id, input.data.modelConfig.provider);
  if (!providerSecretExists) {
    return sendError(
      res,
      409,
      `Missing provider secret for ${input.data.modelConfig.provider}. Configure it in Project Secret or Global Secret UI first.`
    );
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

  let resolvedEnvironment;
  try {
    resolvedEnvironment = await resolveRunEnvironment({
      projectId: project.id,
      explicitEnvironmentId: input.data.environmentId
    });
  } catch (error) {
    return sendError(res, 409, error instanceof Error ? error.message : String(error));
  }

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      attractorDefId: attractorDef.id,
      environmentId: resolvedEnvironment.id,
      environmentSnapshot: resolvedEnvironment.snapshot as never,
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
    environment: resolvedEnvironment.snapshot,
    runnerImage: resolvedEnvironment.snapshot.runnerImage,
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

const runReviewChecklistSchema = z.object({
  summaryReviewed: z.boolean(),
  criticalCodeReviewed: z.boolean(),
  artifactsReviewed: z.boolean(),
  functionalValidationReviewed: z.boolean()
});

const upsertRunReviewSchema = z
  .object({
    reviewer: z.string().min(2).max(120),
    decision: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT", "EXCEPTION"]),
    checklist: runReviewChecklistSchema,
    summary: z.string().max(20000).optional(),
    criticalFindings: z.string().max(20000).optional(),
    artifactFindings: z.string().max(20000).optional(),
    attestation: z.string().max(20000).optional()
  })
  .refine((value) => {
    if (value.decision !== "APPROVE") {
      return true;
    }
    return Object.values(value.checklist).every((item) => item === true);
  }, { message: "All checklist items must be completed before approval." })
  .refine((value) => {
    if (value.decision === "APPROVE") {
      return true;
    }
    return !!toNullableText(value.summary) || !!toNullableText(value.criticalFindings) || !!toNullableText(value.artifactFindings);
  }, { message: "Non-approval decisions require reviewer notes." });

app.get("/api/runs/:runId", async (req, res) => {
  const run = await prisma.run.findUnique({
    where: { id: req.params.runId },
    include: {
      environment: true,
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

app.get("/api/runs/:runId/questions", async (req, res) => {
  const run = await prisma.run.findUnique({ where: { id: req.params.runId } });
  if (!run) {
    return sendError(res, 404, "run not found");
  }

  const questions = await prisma.runQuestion.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "asc" }
  });

  res.json({ questions });
});

const answerRunQuestionSchema = z.object({
  answer: z.string().min(1)
});

app.post("/api/runs/:runId/questions/:questionId/answer", async (req, res) => {
  const input = answerRunQuestionSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const run = await prisma.run.findUnique({ where: { id: req.params.runId } });
  if (!run) {
    return sendError(res, 404, "run not found");
  }

  const question = await prisma.runQuestion.findFirst({
    where: {
      id: req.params.questionId,
      runId: run.id
    }
  });
  if (!question) {
    return sendError(res, 404, "question not found for run");
  }
  if (question.status !== RunQuestionStatus.PENDING) {
    return sendError(res, 409, "question is not pending");
  }

  const updated = await prisma.runQuestion.update({
    where: { id: question.id },
    data: {
      answer: { text: input.data.answer },
      status: RunQuestionStatus.ANSWERED,
      answeredAt: new Date()
    }
  });

  res.json({ question: updated });
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

app.get("/api/runs/:runId/review", async (req, res) => {
  const run = await prisma.run.findUnique({
    where: { id: req.params.runId },
    include: { review: true }
  });
  if (!run) {
    return sendError(res, 404, "run not found");
  }

  const artifacts = await prisma.artifact.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "asc" }
  });
  const rankedArtifacts = rankReviewArtifacts(artifacts);
  const implementationPatchArtifact = artifacts.find((artifact) => artifact.key === "implementation.patch");
  const implementationNoteArtifact = artifacts.find((artifact) => artifact.key === "implementation-note.md");

  let criticalSections: ReviewCriticalSection[] = [];
  if (implementationPatchArtifact) {
    const patchText = await getObjectText(implementationPatchArtifact.path);
    if (patchText) {
      criticalSections = extractCriticalSectionsFromDiff(patchText);
    }
  }

  let summarySuggestion = "";
  if (implementationNoteArtifact) {
    const noteText = await getObjectText(implementationNoteArtifact.path);
    if (noteText) {
      summarySuggestion = summarizeImplementationNote(noteText);
    }
  }

  const sla = reviewSlaStatus(run.createdAt);
  res.json({
    frameworkVersion: RUN_REVIEW_FRAMEWORK_VERSION,
    review: run.review
      ? {
          ...run.review,
          checklist: normalizeStoredChecklist(run.review.checklistJson)
        }
      : null,
    checklistTemplate: reviewChecklistTemplate(),
    pack: {
      dueAt: sla.dueAt.toISOString(),
      overdue: sla.overdue,
      minutesRemaining: sla.minutesRemaining,
      summarySuggestion,
      artifactFocus: rankedArtifacts.slice(0, 8),
      criticalSections: criticalSections.slice(0, 20)
    }
  });
});

app.put("/api/runs/:runId/review", async (req, res) => {
  const input = upsertRunReviewSchema.safeParse(req.body);
  if (!input.success) {
    return sendError(res, 400, input.error.message);
  }

  const run = await prisma.run.findUnique({
    where: { id: req.params.runId }
  });
  if (!run) {
    return sendError(res, 404, "run not found");
  }

  const persisted = await prisma.runReview.upsert({
    where: { runId: run.id },
    update: {
      reviewer: input.data.reviewer,
      decision: input.data.decision as ReviewDecision,
      checklistJson: input.data.checklist as never,
      summary: toNullableText(input.data.summary),
      criticalFindings: toNullableText(input.data.criticalFindings),
      artifactFindings: toNullableText(input.data.artifactFindings),
      attestation: toNullableText(input.data.attestation),
      reviewedAt: new Date()
    },
    create: {
      runId: run.id,
      reviewer: input.data.reviewer,
      decision: input.data.decision as ReviewDecision,
      checklistJson: input.data.checklist as never,
      summary: toNullableText(input.data.summary),
      criticalFindings: toNullableText(input.data.criticalFindings),
      artifactFindings: toNullableText(input.data.artifactFindings),
      attestation: toNullableText(input.data.attestation),
      reviewedAt: new Date()
    }
  });

  await appendRunEvent(run.id, "RunReviewUpdated", {
    runId: run.id,
    reviewer: persisted.reviewer,
    decision: persisted.decision
  });

  res.json({
    review: {
      ...persisted,
      checklist: normalizeStoredChecklist(persisted.checklistJson)
    }
  });
});

app.get("/api/runs/:runId/artifacts/:artifactId/content", async (req, res) => {
  const artifact = await getArtifactByRun(req.params.runId, req.params.artifactId);
  if (!artifact) {
    return sendError(res, 404, "artifact not found for run");
  }

  const previewBytes = clampPreviewBytes(req.query.previewBytes);
  const head = await minioClient.send(
    new HeadObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: artifact.path
    })
  );
  const contentLength = Number(head.ContentLength ?? 0);
  const contentType = head.ContentType ?? artifact.contentType ?? undefined;

  const preview = await minioClient.send(
    new GetObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: artifact.path,
      Range: `bytes=0-${previewBytes - 1}`
    })
  );

  if (!preview.Body) {
    throw new Error(`artifact ${artifact.id} has no object body`);
  }

  const bytes = await bodyToBuffer(preview.Body);
  const isText = isTextByMetadata(contentType, artifact.key) || isProbablyText(bytes);
  const truncated = isText ? contentLength > bytes.length : false;
  const encoding = isText ? "utf-8" : null;

  res.json({
    artifact: {
      id: artifact.id,
      key: artifact.key,
      path: artifact.path,
      contentType,
      sizeBytes: contentLength || artifact.sizeBytes || undefined
    },
    content: isText ? bytes.toString("utf8") : null,
    truncated,
    bytesRead: bytes.length,
    encoding
  });
});

app.get("/api/runs/:runId/artifacts/:artifactId/download", async (req, res) => {
  const artifact = await getArtifactByRun(req.params.runId, req.params.artifactId);
  if (!artifact) {
    return sendError(res, 404, "artifact not found for run");
  }

  const output = await minioClient.send(
    new GetObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: artifact.path
    })
  );

  if (!output.Body) {
    throw new Error(`artifact ${artifact.id} has no object body`);
  }

  const contentType = output.ContentType ?? artifact.contentType ?? "application/octet-stream";
  const contentLength = Number(output.ContentLength ?? artifact.sizeBytes ?? 0);
  const filename = artifact.key.replace(/"/g, "");

  res.setHeader("content-type", contentType);
  if (contentLength > 0) {
    res.setHeader("content-length", String(contentLength));
  }
  res.setHeader("content-disposition", `attachment; filename="${filename}"`);

  const body = output.Body;
  if (body instanceof Readable) {
    body.pipe(res);
    return;
  }

  const bytes = await bodyToBuffer(body);
  res.end(bytes);
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
