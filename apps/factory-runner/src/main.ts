import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { PrismaClient, RunStatus, RunType } from "@prisma/client";
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
import { runCancelKey, runEventChannel, runLockKey, type RunExecutionSpec } from "@attractor/shared-types";
import { extractUnifiedDiff } from "./patch.js";

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

function ensureModel(spec: RunExecutionSpec) {
  if (!getProviders().includes(spec.modelConfig.provider as never)) {
    throw new Error(`Unknown provider ${spec.modelConfig.provider}`);
  }

  const models = getModels(spec.modelConfig.provider as never);
  const found = models.find((model) => model.id === spec.modelConfig.modelId);
  if (!found) {
    throw new Error(`Unknown model ${spec.modelConfig.modelId} for provider ${spec.modelConfig.provider}`);
  }

  return getModel(spec.modelConfig.provider as never, spec.modelConfig.modelId as never);
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

async function runCodergen(prompt: string, spec: RunExecutionSpec, runId: string): Promise<string> {
  const model = ensureModel(spec);
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
      ...(spec.modelConfig.reasoningLevel ? { reasoning: spec.modelConfig.reasoningLevel } : {}),
      ...(spec.modelConfig.temperature !== undefined
        ? { temperature: spec.modelConfig.temperature }
        : {}),
      ...(spec.modelConfig.maxTokens !== undefined ? { maxTokens: spec.modelConfig.maxTokens } : {})
    });

    for await (const event of stream) {
      const mapped = toStreamEvent(event);
      if (mapped) {
        await appendRunEvent(runId, `Model${mapped.type}`, { round, payload: mapped.payload });
      }
    }

    const message = await stream.result();
    context.messages.push(message);

    const toolCalls = message.content.filter(
      (block): block is ToolCall => block.type === "toolCall"
    );

    if (toolCalls.length === 0) {
      return textFromMessage(message);
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

async function processRun(spec: RunExecutionSpec): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: spec.runId },
    include: {
      project: true,
      attractorDef: true,
      referencedSpecBundle: true
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

  if (!run.project.repoFullName) {
    throw new Error("Project repository is not connected");
  }

  const canceled = await redis.get(runCancelKey(run.id));
  if (canceled) {
    throw new Error("Run canceled before execution started");
  }

  const repoPath = checkoutRepository(run.id, run.project.repoFullName, run.sourceBranch);
  const workDir = await repoPath;

  try {
    let attractorContent = "";
    const attractorFile = join(workDir, run.attractorDef.repoPath);
    try {
      attractorContent = readFileSync(attractorFile, "utf8");
    } catch {
      attractorContent = `Attractor file not found at ${run.attractorDef.repoPath}`;
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

      const planText = await runCodergen(planPrompt, spec, run.id);
      const bundle = await createSpecBundle(
        run.id,
        run.projectId,
        run.sourceBranch,
        run.project.repoFullName,
        planText
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

    const implementationText = await runCodergen(implementPrompt, spec, run.id);

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
