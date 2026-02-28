import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand
} from "@aws-sdk/client-s3";
import { App as GitHubApp } from "@octokit/app";
import { PrismaClient, RunQuestionStatus, RunStatus, RunType } from "@prisma/client";
import { Redis } from "ioredis";
import {
  getModel,
  getModels,
  getProviders,
  streamSimple,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type ToolCall
} from "@mariozechner/pi-ai";
import {
  runCancelKey,
  runEventChannel,
  runLockKey,
  type RunModelConfig,
  type RunExecutionEnvironment,
  type RunExecutionSpec
} from "@attractor/shared-types";
import { extractUnifiedDiff } from "./patch.js";
import {
  applyGraphTransforms,
  executeGraph,
  parseDotGraph,
  parseModelStylesheet,
  validateDotGraph,
  type DotNode,
  type EngineState
} from "./engine/index.js";

const execFileAsync = promisify(execFile);

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const minioClient = new S3Client({
  region: "us-east-1",
  endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? "minioadmin"
  }
});
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "factory-artifacts";

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

function parseSpec(): RunExecutionSpec {
  const raw = process.env.RUN_EXECUTION_SPEC;
  if (!raw) {
    throw new Error("RUN_EXECUTION_SPEC is required");
  }

  return JSON.parse(raw) as RunExecutionSpec;
}

function parseEnvironmentSpec(spec: RunExecutionSpec): RunExecutionEnvironment {
  if (spec.environment) {
    return spec.environment;
  }

  const raw = process.env.RUN_ENVIRONMENT_SPEC;
  if (raw) {
    return JSON.parse(raw) as RunExecutionEnvironment;
  }

  return {
    id: "legacy-default",
    name: "legacy-default",
    kind: "KUBERNETES_JOB",
    runnerImage: process.env.RUNNER_IMAGE ?? "ghcr.io/wcraigjones/attractor-factory-runner:latest",
    serviceAccountName: process.env.RUNNER_SERVICE_ACCOUNT ?? "factory-runner"
  };
}

function modelExists(config: Pick<RunModelConfig, "provider" | "modelId">): boolean {
  if (!getProviders().includes(config.provider as never)) {
    return false;
  }
  return getModels(config.provider as never).some((model) => model.id === config.modelId);
}

function resolveModelConfig(config: RunModelConfig): {
  resolved: RunModelConfig;
  fallback?: { fromModelId: string; toModelId: string; reason: string };
} {
  if (modelExists(config)) {
    return { resolved: config };
  }

  if (config.provider === "openrouter" && config.modelId === "openai/gpt-5.3-codex") {
    const fallbackModel = "openai/gpt-5.2-codex";
    if (modelExists({ provider: "openrouter", modelId: fallbackModel })) {
      return {
        resolved: { ...config, modelId: fallbackModel },
        fallback: {
          fromModelId: config.modelId,
          toModelId: fallbackModel,
          reason: "openai/gpt-5.3-codex not present in runtime model catalog"
        }
      };
    }
  }

  throw new Error(`Unknown model ${config.modelId} for provider ${config.provider}`);
}

function ensureModel(config: RunModelConfig) {
  if (!getProviders().includes(config.provider as never)) {
    throw new Error(`Unknown provider ${config.provider}`);
  }
  const model = getModel(config.provider as never, config.modelId as never);
  if (!model) {
    throw new Error(`Unknown model ${config.modelId} for provider ${config.provider}`);
  }
  return model;
}

function toStreamEvent(event: AssistantMessageEvent): { type: string; payload: unknown } | null {
  if (event.type === "text_delta") {
    return { type: "text_delta", payload: { delta: event.delta } };
  }
  if (event.type === "thinking_delta") {
    return { type: "thinking_delta", payload: { delta: event.delta } };
  }
  if (event.type === "toolcall_start") {
    return { type: "toolcall_start", payload: { contentIndex: event.contentIndex } };
  }
  if (event.type === "toolcall_delta") {
    return {
      type: "toolcall_delta",
      payload: { contentIndex: event.contentIndex, delta: event.delta }
    };
  }
  if (event.type === "toolcall_end") {
    return {
      type: "toolcall_end",
      payload: {
        contentIndex: event.contentIndex,
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name
      }
    };
  }
  if (event.type === "done") {
    return { type: "done", payload: { reason: event.reason } };
  }
  if (event.type === "error") {
    return {
      type: "error",
      payload: { reason: event.reason, error: event.error.errorMessage ?? "LLM error" }
    };
  }
  return null;
}

function textFromMessage(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function runCodergen(
  prompt: string,
  runId: string,
  modelConfig: RunModelConfig,
  eventNamespace = "Model"
): Promise<{ text: string; modelConfig: RunModelConfig; fallback?: { fromModelId: string; toModelId: string; reason: string } }> {
  const resolved = resolveModelConfig(modelConfig);
  const model = ensureModel(resolved.resolved);
  const context: Context = {
    messages: [
      {
        role: "user",
        content: prompt,
        timestamp: Date.now()
      }
    ]
  };

  const maxRounds = 8;
  for (let round = 1; round <= maxRounds; round += 1) {
    const stream = streamSimple(model, context, {
      ...(resolved.resolved.reasoningLevel ? { reasoning: resolved.resolved.reasoningLevel } : {}),
      ...(resolved.resolved.temperature !== undefined
        ? { temperature: resolved.resolved.temperature }
        : {}),
      ...(resolved.resolved.maxTokens !== undefined ? { maxTokens: resolved.resolved.maxTokens } : {})
    });

    for await (const event of stream) {
      const mapped = toStreamEvent(event);
      if (mapped) {
        await appendRunEvent(runId, `${eventNamespace}${mapped.type}`, { round, payload: mapped.payload });
      }
    }

    const message = await stream.result();
    context.messages.push(message);

    const toolCalls = message.content.filter(
      (block): block is ToolCall => block.type === "toolCall"
    );

    if (toolCalls.length === 0) {
      return { text: textFromMessage(message), modelConfig: resolved.resolved, ...(resolved.fallback ? { fallback: resolved.fallback } : {}) };
    }

    for (const toolCall of toolCalls) {
      context.messages.push({
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `No external tools are configured yet in factory-runner. Tool ${toolCall.name} was skipped.`
          }
        ],
        isError: true,
        timestamp: Date.now()
      });
    }
  }

  throw new Error(`Model loop exceeded ${maxRounds} rounds`);
}

const SNAPSHOT_IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache"
]);

const SNAPSHOT_MAX_FILES = 200;
const SNAPSHOT_MAX_TOTAL_CHARS = 220_000;
const SNAPSHOT_MAX_FILE_CHARS = 8_000;
const SNAPSHOT_MAX_FILE_SIZE_BYTES = 256_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseOptionalFloat(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseReasoningLevel(
  value: string | undefined
): RunModelConfig["reasoningLevel"] | undefined {
  if (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return undefined;
}

function isProbablyBinary(content: Buffer): boolean {
  const length = Math.min(content.length, 1024);
  for (let index = 0; index < length; index += 1) {
    if (content[index] === 0) {
      return true;
    }
  }
  return false;
}

function shouldIgnoreSnapshotPath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  return parts.some((part) => SNAPSHOT_IGNORED_DIRS.has(part));
}

function listRepositoryFiles(rootDir: string, relDir = ""): string[] {
  const absoluteDir = relDir ? join(rootDir, relDir) : rootDir;
  const entries = readdirSync(absoluteDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];

  for (const entry of entries) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (shouldIgnoreSnapshotPath(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...listRepositoryFiles(rootDir, relPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(relPath);
    }
  }

  return files;
}

function buildRepositorySnapshot(rootDir: string): {
  tree: string;
  content: string;
  filesIncluded: number;
  truncated: boolean;
} {
  const files = listRepositoryFiles(rootDir);
  const tree = files.length > 0 ? files.join("\n") : "(no files found)";

  const sections: string[] = [];
  let totalChars = 0;
  let filesIncluded = 0;
  let truncated = false;

  for (const filePath of files) {
    if (filesIncluded >= SNAPSHOT_MAX_FILES) {
      truncated = true;
      break;
    }

    const absolutePath = join(rootDir, filePath);
    const size = statSync(absolutePath).size;
    if (size > SNAPSHOT_MAX_FILE_SIZE_BYTES) {
      continue;
    }

    const raw = readFileSync(absolutePath);
    if (isProbablyBinary(raw)) {
      continue;
    }

    const text = raw.toString("utf8");
    const clipped = text.slice(0, SNAPSHOT_MAX_FILE_CHARS);
    const section = [
      `### ${filePath}`,
      "```",
      clipped,
      "```"
    ].join("\n");

    if (totalChars + section.length > SNAPSHOT_MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }

    sections.push(section);
    totalChars += section.length;
    filesIncluded += 1;
    if (clipped.length < text.length) {
      truncated = true;
    }
  }

  const content = [
    "## Repository Tree",
    "```text",
    tree,
    "```",
    "",
    "## Repository Content Snapshot",
    sections.join("\n\n"),
    truncated
      ? "\n[Snapshot truncated to fit execution limits]"
      : ""
  ]
    .filter((part) => part.length > 0)
    .join("\n");

  return {
    tree,
    content,
    filesIncluded,
    truncated
  };
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key, item as string])
  );
}

function nestedStringMap(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stringMap(item)])
  );
}

function normalizeEngineState(value: unknown): EngineState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  return {
    context:
      payload.context && typeof payload.context === "object"
        ? (payload.context as Record<string, unknown>)
        : {},
    nodeOutputs: stringMap(payload.nodeOutputs),
    parallelOutputs: nestedStringMap(payload.parallelOutputs),
    nodeOutcomes: {},
    nodeRetryCounts: {},
    completedNodes:
      Array.isArray(payload.completedNodes) &&
      payload.completedNodes.every((item) => typeof item === "string")
        ? (payload.completedNodes as string[])
        : []
  };
}

function answerText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }
  return "";
}

function nodeModelConfig(defaultConfig: RunModelConfig, node: DotNode): RunModelConfig {
  const reasoningLevel =
    parseReasoningLevel(node.attrs.reasoning ?? node.attrs.reasoning_level) ??
    defaultConfig.reasoningLevel;
  const temperature = parseOptionalFloat(node.attrs.temperature) ?? defaultConfig.temperature;
  const maxTokens =
    parseOptionalInt(node.attrs.max_tokens ?? node.attrs.maxTokens) ?? defaultConfig.maxTokens;

  return {
    provider: node.attrs.provider ?? defaultConfig.provider,
    modelId: node.attrs.model ?? node.attrs.model_id ?? defaultConfig.modelId,
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {})
  };
}

function renderTaskReport(args: {
  output: string;
  runId: string;
  repoFullName: string;
  sourceBranch: string;
  exitNodeId: string;
  finalNodeId: string | null;
  modelResolutions: Array<{
    nodeId: string;
    requested: RunModelConfig;
    resolved: RunModelConfig;
    fallback?: { fromModelId: string; toModelId: string; reason: string };
  }>;
}): string {
  const metadata = {
    runId: args.runId,
    repository: args.repoFullName,
    sourceBranch: args.sourceBranch,
    exitNodeId: args.exitNodeId,
    finalNodeId: args.finalNodeId,
    generatedAt: new Date().toISOString(),
    modelResolutions: args.modelResolutions
  };

  const body = args.output.trim().length > 0 ? args.output.trim() : "_No report content generated._";
  return `<!--\n${JSON.stringify(metadata, null, 2)}\n-->\n\n${body}\n`;
}

async function ensureBucketExists(): Promise<void> {
  try {
    await minioClient.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET }));
    return;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (error as { name?: string })?.name;
    if (status === 404 || name === "NotFound" || name === "NoSuchBucket") {
      await minioClient.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET }));
      return;
    }
    throw error;
  }
}

async function putObject(key: string, content: string, contentType = "text/plain"): Promise<void> {
  await minioClient.send(
    new PutObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
      Body: content,
      ContentType: contentType
    })
  );
}

async function getObjectString(key: string): Promise<string> {
  const output = await minioClient.send(new GetObjectCommand({ Bucket: MINIO_BUCKET, Key: key }));
  if (!output.Body) {
    throw new Error(`Object ${key} has no body`);
  }

  const body = output.Body as { transformToString?: () => Promise<string> };
  if (body.transformToString) {
    return body.transformToString();
  }

  throw new Error("Unsupported S3 body stream implementation");
}

function gitRemote(repoFullName: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return `https://github.com/${repoFullName}.git`;
  }
  return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync(command, args, { cwd });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function hasStagedChanges(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd });
    return false;
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 1 || code === "1") {
      return true;
    }
    throw error;
  }
}

async function checkoutRepository(runId: string, repoFullName: string, sourceBranch: string): Promise<string> {
  const workDir = mkdtempSync(join(tmpdir(), `factory-run-${runId}-`));
  await runCommand("git", ["clone", "--depth", "1", "--branch", sourceBranch, gitRemote(repoFullName), workDir], tmpdir());
  return workDir;
}

async function createSpecBundle(runId: string, projectId: string, sourceBranch: string, repo: string, planText: string): Promise<{ specBundleId: string; manifestPath: string }> {
  const schemaVersion = "v1";
  const prefix = `spec-bundles/${projectId}/${runId}`;

  const files: Array<{ name: string; content: string; contentType: string }> = [
    { name: "plan.md", content: planText, contentType: "text/markdown" },
    {
      name: "requirements.md",
      content: `# Requirements\n\nGenerated by planning run ${runId}.`,
      contentType: "text/markdown"
    },
    {
      name: "tasks.json",
      content: JSON.stringify({ tasks: [{ id: "task-1", title: "Implement planned changes" }] }, null, 2),
      contentType: "application/json"
    },
    {
      name: "acceptance-tests.md",
      content: "# Acceptance Tests\n\n- Validate generated implementation.",
      contentType: "text/markdown"
    }
  ];

  const artifacts = files.map(({ name }) => ({
    name,
    path: `${prefix}/${name}`
  }));

  const manifest = {
    schema_version: schemaVersion,
    project_id: projectId,
    source_run_id: runId,
    repo,
    source_branch: sourceBranch,
    created_at: new Date().toISOString(),
    artifacts,
    checksums: {}
  };

  for (const file of files) {
    await putObject(`${prefix}/${file.name}`, file.content, file.contentType);
  }

  const manifestPath = `${prefix}/manifest.json`;
  await putObject(manifestPath, JSON.stringify(manifest, null, 2), "application/json");

  const specBundle = await prisma.specBundle.create({
    data: {
      runId,
      schemaVersion,
      manifestPath
    }
  });

  await prisma.artifact.createMany({
    data: files.map((file) => ({
      runId,
      key: file.name,
      path: `${prefix}/${file.name}`,
      contentType: file.contentType,
      sizeBytes: Buffer.byteLength(file.content, "utf8")
    }))
  });

  return {
    specBundleId: specBundle.id,
    manifestPath
  };
}

function githubApp(): GitHubApp | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    return null;
  }

  return new GitHubApp({ appId, privateKey: privateKey.replace(/\\n/g, "\n") });
}

async function createPullRequest(args: {
  installationId?: string;
  repoFullName: string;
  baseBranch: string;
  headBranch: string;
  runId: string;
  body: string;
}): Promise<string | null> {
  const [owner, repo] = args.repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${args.repoFullName}`);
  }

  if (args.installationId) {
    const app = githubApp();
    if (app) {
      const octokit = await app.getInstallationOctokit(Number(args.installationId));
      const pr = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        base: args.baseBranch,
        head: args.headBranch,
        title: `Attractor run ${args.runId}`,
        body: args.body
      });
      return pr.data.html_url ?? null;
    }
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }

  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: token });
  const pr = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    base: args.baseBranch,
    head: args.headBranch,
    title: `Attractor run ${args.runId}`,
    body: args.body
  });
  return pr.data.html_url ?? null;
}

async function assertRunNotCanceled(runId: string): Promise<void> {
  const canceled = await redis.get(runCancelKey(runId));
  if (canceled) {
    throw new Error("Run canceled during execution");
  }
}

async function waitForHumanQuestion(args: {
  runId: string;
  nodeId: string;
  prompt: string;
  options?: string[];
  timeoutMs?: number;
}): Promise<string> {
  const existingPending = await prisma.runQuestion.findFirst({
    where: {
      runId: args.runId,
      nodeId: args.nodeId,
      prompt: args.prompt,
      status: RunQuestionStatus.PENDING
    },
    orderBy: { createdAt: "desc" }
  });

  if (!existingPending) {
    const existingAnswered = await prisma.runQuestion.findFirst({
      where: {
        runId: args.runId,
        nodeId: args.nodeId,
        prompt: args.prompt,
        status: RunQuestionStatus.ANSWERED
      },
      orderBy: { answeredAt: "desc" }
    });
    if (existingAnswered) {
      const text = answerText(existingAnswered.answer);
      if (text.trim().length > 0) {
        return text;
      }
    }
  }

  const question =
    existingPending ??
    (await prisma.runQuestion.create({
      data: {
        runId: args.runId,
        nodeId: args.nodeId,
        prompt: args.prompt,
        options: args.options as never
      }
    }));

  await appendRunEvent(args.runId, "HumanQuestionPending", {
    runId: args.runId,
    questionId: question.id,
    nodeId: args.nodeId,
    prompt: args.prompt,
    hasOptions: Boolean(args.options && args.options.length > 0),
    timeoutMs: args.timeoutMs ?? null
  });

  const deadline = args.timeoutMs ? Date.now() + args.timeoutMs : null;
  while (true) {
    await assertRunNotCanceled(args.runId);

    const current = await prisma.runQuestion.findUnique({
      where: { id: question.id }
    });
    if (!current) {
      throw new Error(`Question ${question.id} no longer exists`);
    }

    if (current.status === RunQuestionStatus.ANSWERED) {
      const text = answerText(current.answer);
      if (text.trim().length === 0) {
        throw new Error(`Question ${question.id} has an empty answer`);
      }
      await appendRunEvent(args.runId, "HumanQuestionAnswered", {
        runId: args.runId,
        questionId: question.id,
        nodeId: args.nodeId
      });
      return text;
    }

    if (current.status === RunQuestionStatus.TIMEOUT) {
      throw new Error(`Question ${question.id} timed out`);
    }

    if (deadline && Date.now() > deadline) {
      await prisma.runQuestion.updateMany({
        where: {
          id: question.id,
          status: RunQuestionStatus.PENDING
        },
        data: {
          status: RunQuestionStatus.TIMEOUT
        }
      });
      await appendRunEvent(args.runId, "HumanQuestionTimedOut", {
        runId: args.runId,
        questionId: question.id,
        nodeId: args.nodeId,
        timeoutMs: args.timeoutMs
      });
      throw new Error(`Question ${question.id} timed out`);
    }

    await sleep(2000);
  }
}

function selectFinalOutputNodeId(graph: ReturnType<typeof parseDotGraph>, state: EngineState): string | null {
  const preferredIds = [
    graph.graphAttrs.final_output_node,
    graph.graphAttrs.finalOutputNode,
    graph.graphAttrs.synthesis_node,
    graph.graphAttrs.synthesisNode
  ]
    .map((item) => item?.trim() ?? "")
    .filter((item) => item.length > 0);

  for (const nodeId of preferredIds) {
    if (state.nodeOutputs[nodeId] && state.nodeOutputs[nodeId].trim().length > 0) {
      return nodeId;
    }
  }

  for (let index = graph.nodeOrder.length - 1; index >= 0; index -= 1) {
    const nodeId = graph.nodeOrder[index] ?? "";
    const output = state.nodeOutputs[nodeId];
    if (output && output.trim().length > 0) {
      return nodeId;
    }
  }

  return null;
}

async function processTaskRun(args: {
  runId: string;
  projectId: string;
  repoFullName: string;
  sourceBranch: string;
  targetBranch: string;
  workDir: string;
  attractorContent: string;
  modelConfig: RunModelConfig;
  checkpoint: { currentNodeId: string; contextJson: unknown } | null;
}): Promise<{
  artifactKey: string;
  artifactPath: string;
  exitNodeId: string;
  finalNodeId: string | null;
}> {
  const parsed = parseDotGraph(args.attractorContent);
  const stylesheetConfig = parsed.graphAttrs.model_stylesheet ?? parsed.graphAttrs.modelStylesheet;
  if (stylesheetConfig && stylesheetConfig.trim().length > 0) {
    const trimmed = stylesheetConfig.trim();
    const source = trimmed.includes("{")
      ? trimmed
      : readFileSync(join(args.workDir, trimmed), "utf8");
    const rules = parseModelStylesheet(source);
    parsed.graphAttrs.model_stylesheet = source;
    await appendRunEvent(args.runId, "ModelStylesheetLoaded", {
      runId: args.runId,
      ruleCount: rules.length
    });
  }
  const graph = applyGraphTransforms(parsed);
  validateDotGraph(graph);

  const snapshot = buildRepositorySnapshot(args.workDir);
  await appendRunEvent(args.runId, "TaskRepositorySnapshotPrepared", {
    runId: args.runId,
    filesIncluded: snapshot.filesIncluded,
    truncated: snapshot.truncated
  });

  const restoredState = normalizeEngineState(args.checkpoint?.contextJson);
  const initialState: EngineState =
    restoredState ?? {
      context: {},
      nodeOutputs: {},
      parallelOutputs: {},
      nodeOutcomes: {},
      nodeRetryCounts: {},
      completedNodes: []
    };

  initialState.context = {
    ...initialState.context,
    runId: args.runId,
    repository: args.repoFullName,
    sourceBranch: args.sourceBranch,
    targetBranch: args.targetBranch,
    repositoryTree: snapshot.tree,
    repositorySnapshot: snapshot.content
  };

  const modelResolutions = new Map<
    string,
    {
      nodeId: string;
      requested: RunModelConfig;
      resolved: RunModelConfig;
      fallback?: { fromModelId: string; toModelId: string; reason: string };
    }
  >();

  const maxSteps = parseOptionalInt(graph.graphAttrs.max_steps ?? graph.graphAttrs.maxSteps) ?? 1000;
  const execution = await executeGraph({
    graph,
    initialState,
    ...(args.checkpoint?.currentNodeId ? { startNodeId: args.checkpoint.currentNodeId } : {}),
    maxSteps,
    callbacks: {
      codergen: async ({ node, prompt, state }) => {
        await assertRunNotCanceled(args.runId);
        const requested = nodeModelConfig(args.modelConfig, node);
        const result = await runCodergen(prompt, args.runId, requested, `Node.${node.id}.`);
        modelResolutions.set(node.id, {
          nodeId: node.id,
          requested,
          resolved: result.modelConfig,
          ...(result.fallback ? { fallback: result.fallback } : {})
        });
        if (result.fallback) {
          await appendRunEvent(args.runId, "ModelFallbackApplied", {
            runId: args.runId,
            nodeId: node.id,
            provider: result.modelConfig.provider,
            fromModelId: result.fallback.fromModelId,
            toModelId: result.fallback.toModelId,
            reason: result.fallback.reason
          });
        }
        return result.text;
      },
      tool: async ({ node }) => {
        await appendRunEvent(args.runId, "TaskToolNodeExecuted", {
          runId: args.runId,
          nodeId: node.id,
          tool: node.attrs.tool ?? null
        });
        return node.attrs.output ?? `Tool node ${node.id} executed`;
      },
      waitForHuman: async (question) =>
        waitForHumanQuestion({
          runId: args.runId,
          nodeId: question.nodeId,
          prompt: question.prompt,
          options: question.options,
          timeoutMs: question.timeoutMs
        }),
      onEvent: async (event) => {
        await appendRunEvent(args.runId, `Engine${event.type}`, {
          runId: args.runId,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
          ...(event.payload !== undefined ? { payload: event.payload } : {})
        });
      },
      saveCheckpoint: async (nodeId, state) => {
        await prisma.runCheckpoint.upsert({
          where: { runId: args.runId },
          update: {
            currentNodeId: nodeId,
            contextJson: state as never
          },
          create: {
            runId: args.runId,
            currentNodeId: nodeId,
            contextJson: state as never
          }
        });
      },
      saveOutcome: async (nodeId, status, payload, attempt) => {
        await prisma.runNodeOutcome.create({
          data: {
            runId: args.runId,
            nodeId,
            status,
            attempt,
            payload: payload as never
          }
        });
      }
    }
  });

  const finalNodeId = selectFinalOutputNodeId(graph, execution.state);
  const outputText = finalNodeId ? execution.state.nodeOutputs[finalNodeId] ?? "" : "";
  const artifactKey =
    (graph.graphAttrs.final_artifact_key ?? graph.graphAttrs.finalArtifactKey ?? "task-report.md").trim() ||
    "task-report.md";

  const report = renderTaskReport({
    output: outputText,
    runId: args.runId,
    repoFullName: args.repoFullName,
    sourceBranch: args.sourceBranch,
    exitNodeId: execution.exitNodeId,
    finalNodeId,
    modelResolutions: [...modelResolutions.values()]
  });

  const artifactPath = `runs/${args.projectId}/${args.runId}/${artifactKey}`;
  await prisma.artifact.deleteMany({
    where: {
      runId: args.runId
    }
  });
  await putObject(artifactPath, report, "text/markdown");
  await prisma.artifact.create({
    data: {
      runId: args.runId,
      key: artifactKey,
      path: artifactPath,
      contentType: "text/markdown",
      sizeBytes: Buffer.byteLength(report, "utf8")
    }
  });

  await appendRunEvent(args.runId, "TaskArtifactWritten", {
    runId: args.runId,
    artifactKey,
    artifactPath,
    finalNodeId,
    exitNodeId: execution.exitNodeId
  });

  return {
    artifactKey,
    artifactPath,
    exitNodeId: execution.exitNodeId,
    finalNodeId
  };
}

async function processRun(spec: RunExecutionSpec): Promise<void> {
  const environment = parseEnvironmentSpec(spec);
  const run = await prisma.run.findUnique({
    where: { id: spec.runId },
    include: {
      project: true,
      attractorDef: true,
      referencedSpecBundle: true,
      checkpoint: true
    }
  });

  if (!run) {
    throw new Error(`Run ${spec.runId} not found`);
  }

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: RunStatus.RUNNING,
      startedAt: run.startedAt ?? new Date()
    }
  });

  await appendRunEvent(run.id, "RunStarted", {
    runId: run.id,
    runType: run.runType,
    sourceBranch: run.sourceBranch,
    targetBranch: run.targetBranch
  });

  await appendRunEvent(run.id, "EnvironmentResolved", {
    runId: run.id,
    environment
  });

  if (!run.project.repoFullName) {
    throw new Error("Project repository is not connected");
  }

  await assertRunNotCanceled(run.id);
  const workDir = await checkoutRepository(run.id, run.project.repoFullName, run.sourceBranch);

  try {
    const attractorFile = join(workDir, run.attractorDef.repoPath);
    const attractorContent = readFileSync(attractorFile, "utf8");

    if (run.runType === RunType.task) {
      const taskResult = await processTaskRun({
        runId: run.id,
        projectId: run.projectId,
        repoFullName: run.project.repoFullName,
        sourceBranch: run.sourceBranch,
        targetBranch: run.targetBranch,
        workDir,
        attractorContent,
        modelConfig: spec.modelConfig,
        checkpoint: run.checkpoint
          ? {
              currentNodeId: run.checkpoint.currentNodeId,
              contextJson: run.checkpoint.contextJson
            }
          : null
      });

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.SUCCEEDED,
          finishedAt: new Date(),
          prUrl: null
        }
      });

      await appendRunEvent(run.id, "RunCompleted", {
        runId: run.id,
        status: "SUCCEEDED",
        artifactKey: taskResult.artifactKey,
        artifactPath: taskResult.artifactPath,
        exitNodeId: taskResult.exitNodeId,
        finalNodeId: taskResult.finalNodeId
      });
      return;
    }

    if (run.runType === RunType.planning) {
      const planPrompt = [
        "You are generating a project planning bundle for a coding run.",
        `Repository: ${run.project.repoFullName}`,
        `Source branch: ${run.sourceBranch}`,
        "Produce an actionable plan and requirements with acceptance tests.",
        "Attractor definition:",
        attractorContent
      ].join("\n\n");

      const planResult = await runCodergen(planPrompt, run.id, spec.modelConfig);
      if (planResult.fallback) {
        await appendRunEvent(run.id, "ModelFallbackApplied", {
          runId: run.id,
          provider: planResult.modelConfig.provider,
          fromModelId: planResult.fallback.fromModelId,
          toModelId: planResult.fallback.toModelId,
          reason: planResult.fallback.reason
        });
      }

      const bundle = await createSpecBundle(
        run.id,
        run.projectId,
        run.sourceBranch,
        run.project.repoFullName,
        planResult.text
      );

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.SUCCEEDED,
          finishedAt: new Date(),
          specBundleId: bundle.specBundleId
        }
      });

      await appendRunEvent(run.id, "RunCompleted", {
        runId: run.id,
        status: "SUCCEEDED",
        manifestPath: bundle.manifestPath
      });
      return;
    }

    if (!run.specBundleId || !run.referencedSpecBundle) {
      throw new Error("Implementation run requires specBundleId");
    }

    if (run.referencedSpecBundle.schemaVersion !== "v1") {
      throw new Error(`Unsupported spec bundle schema version ${run.referencedSpecBundle.schemaVersion}`);
    }

    const manifestRaw = await getObjectString(run.referencedSpecBundle.manifestPath);
    const manifest = JSON.parse(manifestRaw) as { artifacts?: Array<{ path: string }> };

    const planPath = manifest.artifacts?.find((artifact) => artifact.path.endsWith("plan.md"))?.path;
    const planText = planPath ? await getObjectString(planPath) : "No plan.md found in bundle";

    const implementPrompt = [
      "You are implementing a planned change in a repository.",
      `Repository: ${run.project.repoFullName}`,
      `Source branch: ${run.sourceBranch}`,
      `Target branch: ${run.targetBranch}`,
      "Use the plan to produce concrete code changes.",
      "Return a concise summary and a valid unified git diff in a fenced ```diff block.",
      "The diff must be directly applicable from repository root with git apply.",
      "Plan:",
      planText
    ].join("\n\n");

    const implementationResult = await runCodergen(
      implementPrompt,
      run.id,
      spec.modelConfig
    );
    if (implementationResult.fallback) {
      await appendRunEvent(run.id, "ModelFallbackApplied", {
        runId: run.id,
        provider: implementationResult.modelConfig.provider,
        fromModelId: implementationResult.fallback.fromModelId,
        toModelId: implementationResult.fallback.toModelId,
        reason: implementationResult.fallback.reason
      });
    }
    const implementationText = implementationResult.text;

    await runCommand("git", ["checkout", "-B", run.targetBranch], workDir);

    const outputDir = join(workDir, ".attractor");
    mkdirSync(outputDir, { recursive: true });
    const outputFile = join(outputDir, `implementation-${run.id}.md`);
    writeFileSync(outputFile, implementationText, "utf8");

    await runCommand("git", ["add", outputFile], workDir);

    const extractedDiff = extractUnifiedDiff(implementationText);
    if (extractedDiff) {
      await appendRunEvent(run.id, "ImplementationPatchExtracted", {
        runId: run.id,
        bytes: Buffer.byteLength(extractedDiff, "utf8")
      });
      const patchFile = join(outputDir, `implementation-${run.id}.patch`);
      writeFileSync(patchFile, extractedDiff, "utf8");

      try {
        await runCommand("git", ["apply", "--index", patchFile], workDir);
      } catch (error) {
        await appendRunEvent(run.id, "ImplementationPatchApplyFailed", {
          runId: run.id,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      const patchArtifactPath = `runs/${run.projectId}/${run.id}/implementation.patch`;
      await putObject(patchArtifactPath, extractedDiff, "text/x-diff");
      await prisma.artifact.create({
        data: {
          runId: run.id,
          key: "implementation.patch",
          path: patchArtifactPath,
          contentType: "text/x-diff",
          sizeBytes: Buffer.byteLength(extractedDiff, "utf8")
        }
      });

      await appendRunEvent(run.id, "ImplementationPatchApplied", {
        runId: run.id,
        patchArtifactPath
      });
    } else {
      await appendRunEvent(run.id, "ImplementationPatchMissing", {
        runId: run.id
      });
    }

    if (!(await hasStagedChanges(workDir))) {
      throw new Error("Implementation run produced no staged changes");
    }

    await runCommand("git", ["commit", "-m", `attractor: implementation run ${run.id}`], workDir);
    await runCommand("git", ["push", "origin", run.targetBranch, "--force-with-lease"], workDir);

    let prUrl: string | null = null;
    const artifactPath = `runs/${run.projectId}/${run.id}/implementation-note.md`;
    await putObject(artifactPath, implementationText, "text/markdown");
    await prisma.artifact.create({
      data: {
        runId: run.id,
        key: "implementation-note.md",
        path: artifactPath,
        contentType: "text/markdown",
        sizeBytes: Buffer.byteLength(implementationText, "utf8")
      }
    });

    prUrl = await createPullRequest({
      installationId: run.project.githubInstallationId ?? undefined,
      repoFullName: run.project.repoFullName,
      baseBranch: run.project.defaultBranch ?? run.sourceBranch,
      headBranch: run.targetBranch,
      runId: run.id,
      body: `Automated implementation run ${run.id}`
    });

    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        finishedAt: new Date(),
        prUrl
      }
    });

    await appendRunEvent(run.id, "RunCompleted", {
      runId: run.id,
      status: "SUCCEEDED",
      prUrl
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    if (run.runType === RunType.implementation) {
      await redis.del(runLockKey(run.projectId, run.targetBranch));
    }
  }
}

async function main() {
  const spec = parseSpec();
  await ensureBucketExists();

  try {
    await processRun(spec);
  } catch (error) {
    const runId = spec.runId;
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.FAILED,
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error)
      }
    });

    await appendRunEvent(runId, "RunFailed", {
      runId,
      message: error instanceof Error ? error.message : String(error)
    });

    if (spec.runType === "implementation") {
      await redis.del(runLockKey(spec.projectId, spec.targetBranch));
    }

    throw error;
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
