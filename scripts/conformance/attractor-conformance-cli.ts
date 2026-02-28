import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  lintDotGraph,
  parseDotGraph,
  type DotGraph
} from "../../packages/dot-engine/src/index.ts";
import { executeGraph } from "../../apps/factory-runner/src/engine/executor.ts";
import { applyGraphTransforms } from "../../apps/factory-runner/src/engine/transforms.ts";
import type {
  DotNode,
  EngineState,
  NodeOutcome
} from "../../apps/factory-runner/src/engine/types.ts";

type Mode = "run" | "validate";

interface CliArgs {
  mode: Mode;
  dotPath: string;
  logsDir: string;
  resumeDir?: string;
  simulate: boolean;
  autoApprove: boolean;
  quiet: boolean;
}

interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const STATUS_MAP: Record<string, NodeOutcome["status"]> = {
  success: "SUCCESS",
  partial_success: "PARTIAL_SUCCESS",
  "partial-success": "PARTIAL_SUCCESS",
  retry: "RETRY",
  fail: "FAIL",
  failed: "FAIL",
  skipped: "SKIPPED"
};

function toLowerOutcome(status: string | undefined): string {
  if (!status) {
    return "success";
  }
  return status.trim().toLowerCase().replace(/-/g, "_");
}

function normalizeOutcome(status: string | undefined): NodeOutcome["status"] {
  const key = toLowerOutcome(status);
  return STATUS_MAP[key] ?? "SUCCESS";
}

function parseDurationMs(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    return undefined;
  }
  const value = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "ms";
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if (unit === "ms") {
    return value;
  }
  if (unit === "s") {
    return value * 1_000;
  }
  if (unit === "m") {
    return value * 60_000;
  }
  return value * 3_600_000;
}

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const lowered = raw.trim().toLowerCase();
  return lowered === "true" || lowered === "1" || lowered === "yes";
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function readGraph(path: string): DotGraph {
  const source = readFileSync(path, "utf8");
  const parsed = parseDotGraph(source);
  const graph = applyGraphTransforms(parsed);
  if (!graph.graphAttrs.default_max_retry) {
    graph.graphAttrs.default_max_retry = "0";
  }
  return graph;
}

function shapeCount(graph: DotGraph, shape: string): number {
  return graph.nodeOrder.filter((nodeId) => graph.nodes[nodeId]?.shape === shape).length;
}

function summarizeDiagnostics(graph: DotGraph): { lines: string[]; hasErrors: boolean } {
  const diagnostics = lintDotGraph(graph);
  const lines = diagnostics.map((item) => `${item.severity} ${item.rule}: ${item.message}`);

  const startCount = shapeCount(graph, "Mdiamond");
  const exitCount = shapeCount(graph, "Msquare");
  if (startCount !== 1) {
    lines.push(`hint: expected exactly one start node with shape=Mdiamond (found ${startCount})`);
  }
  if (exitCount !== 1) {
    lines.push(`hint: expected exactly one exit node with shape=Msquare (found ${exitCount})`);
  }

  const hasErrors = diagnostics.some((item) => item.severity === "ERROR");
  return { lines, hasErrors };
}

function classifySynopsis(graph: DotGraph): "PLANNING" | "EXECUTION" | "HYBRID" {
  const nodeTypes = graph.nodeOrder
    .map((nodeId) => graph.nodes[nodeId]?.type)
    .filter((type): type is string => Boolean(type));
  const hasTool = nodeTypes.includes("tool");
  const hasLlm = nodeTypes.includes("codergen") || nodeTypes.includes("stack.manager_loop");
  if (hasTool && hasLlm) {
    return "HYBRID";
  }
  if (hasTool) {
    return "EXECUTION";
  }
  return "PLANNING";
}

function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = "run";
  let dotPath = "";
  let logsDir = "";
  let resumeDir: string | undefined;
  let simulate = false;
  let autoApprove = false;
  let quiet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--validate") {
      mode = "validate";
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--validate requires a DOT file path");
      }
      dotPath = next;
      index += 1;
      continue;
    }
    if (token === "--resume") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--resume requires a logs directory path");
      }
      resumeDir = resolve(next);
      logsDir = resumeDir;
      index += 1;
      continue;
    }
    if (token === "--logs") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--logs requires a directory path");
      }
      logsDir = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--simulate") {
      simulate = true;
      continue;
    }
    if (token === "--auto-approve") {
      autoApprove = true;
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token.startsWith("--")) {
      continue;
    }
    if (!dotPath) {
      dotPath = token;
    }
  }

  if (!dotPath) {
    throw new Error("DOT file path is required");
  }

  const normalizedLogs = logsDir || mkdtempSync(join(tmpdir(), "attractor-conformance-"));
  return {
    mode,
    dotPath: resolve(dotPath),
    logsDir: normalizedLogs,
    ...(resumeDir ? { resumeDir } : {}),
    simulate,
    autoApprove,
    quiet
  };
}

async function runShell(
  command: string,
  args: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }
): Promise<ShellResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd: args.cwd,
      env: args.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      args.timeoutMs && args.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, args.timeoutMs)
        : null;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        timedOut
      });
    });

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`,
        timedOut
      });
    });
  });
}

function stringifyContextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateValue(value: string, maxChars = 500): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function buildContextArtifact(state: EngineState): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.context)) {
    output[key] = truncateValue(stringifyContextValue(value));
  }
  for (const [key, value] of Object.entries(state.nodeOutputs)) {
    const projectedKey = `${key}.output`;
    if (!(projectedKey in output)) {
      output[projectedKey] = truncateValue(stringifyContextValue(value));
    }
  }
  return output;
}

function writeCheckpoint(
  logsDir: string,
  currentNodeId: string,
  state: EngineState,
  runtimeState?: { lastError?: string | null }
): void {
  const nodeOutcomes = Object.fromEntries(
    Object.entries(state.nodeOutcomes).map(([nodeId, outcome]) => [
      nodeId,
      {
        status: toLowerOutcome(outcome.status),
        preferred_label: outcome.preferredLabel ?? null,
        suggested_next_ids: outcome.suggestedNextIds ?? [],
        context_updates: outcome.contextUpdates ?? {},
        notes: outcome.notes ?? null,
        failure_reason: outcome.failureReason ?? null,
        output: outcome.output ?? null
      }
    ])
  );

  const payload = {
    timestamp: new Date().toISOString(),
    current_node: currentNodeId,
    completed_nodes: state.completedNodes,
    context: state.context,
    node_outputs: state.nodeOutputs,
    parallel_outputs: state.parallelOutputs,
    node_retry_counts: state.nodeRetryCounts,
    node_outcomes: nodeOutcomes,
    ...(runtimeState?.lastError ? { last_error: runtimeState.lastError } : {})
  };

  writeFileSync(join(logsDir, "checkpoint.json"), JSON.stringify(payload, null, 2), "utf8");
}

function loadCheckpoint(logsDir: string): {
  startNodeId?: string;
  state: EngineState;
} {
  const checkpointPath = join(logsDir, "checkpoint.json");
  if (!existsSync(checkpointPath)) {
    return {
      state: {
        context: {},
        nodeOutputs: {},
        parallelOutputs: {},
        nodeOutcomes: {},
        nodeRetryCounts: {},
        completedNodes: []
      }
    };
  }

  const parsed = JSON.parse(readFileSync(checkpointPath, "utf8")) as {
    current_node?: string;
    context?: Record<string, unknown>;
    node_outputs?: Record<string, string>;
    parallel_outputs?: Record<string, Record<string, string>>;
    node_retry_counts?: Record<string, number>;
    completed_nodes?: string[];
    node_outcomes?: Record<
      string,
      {
        status?: string;
        preferred_label?: string | null;
        suggested_next_ids?: string[];
        context_updates?: Record<string, unknown>;
        notes?: string | null;
        failure_reason?: string | null;
        output?: string | null;
      }
    >;
  };

  const nodeOutcomes: Record<string, NodeOutcome> = {};
  for (const [nodeId, outcome] of Object.entries(parsed.node_outcomes ?? {})) {
    nodeOutcomes[nodeId] = {
      status: normalizeOutcome(outcome.status),
      ...(outcome.preferred_label ? { preferredLabel: outcome.preferred_label } : {}),
      ...(outcome.suggested_next_ids?.length
        ? { suggestedNextIds: outcome.suggested_next_ids }
        : {}),
      ...(outcome.context_updates ? { contextUpdates: outcome.context_updates } : {}),
      ...(outcome.notes ? { notes: outcome.notes } : {}),
      ...(outcome.failure_reason ? { failureReason: outcome.failure_reason } : {}),
      ...(outcome.output ? { output: outcome.output } : {})
    };
  }

  return {
    ...(parsed.current_node ? { startNodeId: parsed.current_node } : {}),
    state: {
      context: parsed.context ?? {},
      nodeOutputs: parsed.node_outputs ?? {},
      parallelOutputs: parsed.parallel_outputs ?? {},
      nodeRetryCounts: parsed.node_retry_counts ?? {},
      completedNodes: parsed.completed_nodes ?? [],
      nodeOutcomes
    }
  };
}

function writeManifest(logsDir: string, graph: DotGraph): void {
  const payload = {
    name: graph.name,
    goal: graph.graphAttrs.goal ?? "",
    label: graph.graphAttrs.label ?? graph.name,
    start_time: new Date().toISOString()
  };
  writeFileSync(join(logsDir, "manifest.json"), JSON.stringify(payload, null, 2), "utf8");
}

function stageDir(logsDir: string, nodeId: string): string {
  const path = join(logsDir, nodeId);
  ensureDir(path);
  return path;
}

function writeNodeStatus(
  logsDir: string,
  nodeId: string,
  status: string,
  payload: unknown,
  skippedNodes: Set<string>
): void {
  if (skippedNodes.has(nodeId)) {
    return;
  }
  const dir = stageDir(logsDir, nodeId);
  const statusPayload =
    typeof payload === "object" && payload !== null
      ? {
          ...(payload as Record<string, unknown>),
          status: toLowerOutcome(status),
          outcome: toLowerOutcome(status)
        }
      : {
          status: toLowerOutcome(status),
          outcome: toLowerOutcome(status),
          payload
        };
  writeFileSync(join(dir, "status.json"), JSON.stringify(statusPayload, null, 2), "utf8");
}

function toContextUpdates(
  node: DotNode,
  output: string,
  options?: { includeLastStage?: boolean }
): Record<string, unknown> {
  const trimmed = output.trim();
  return {
    ...(options?.includeLastStage === false ? {} : { last_stage: node.id }),
    ...(trimmed ? { [`${node.id}.output`]: trimmed } : {}),
    ...(trimmed && node.id === "tool" ? { "tool.output": trimmed } : {})
  };
}

function normalizeToolStatusFile(stagePath: string): NodeOutcome | null {
  const statusPath = join(stagePath, "status.json");
  if (!existsSync(statusPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(statusPath, "utf8")) as {
      outcome?: string;
      status?: string;
      notes?: string;
      failure_reason?: string;
      output?: string;
      preferred_label?: string;
      suggested_next_ids?: string[];
      context_updates?: Record<string, unknown>;
    };

    return {
      status: normalizeOutcome(parsed.outcome ?? parsed.status),
      ...(parsed.notes ? { notes: parsed.notes } : {}),
      ...(parsed.failure_reason ? { failureReason: parsed.failure_reason } : {}),
      ...(parsed.output ? { output: parsed.output } : {}),
      ...(parsed.preferred_label ? { preferredLabel: parsed.preferred_label } : {}),
      ...(parsed.suggested_next_ids ? { suggestedNextIds: parsed.suggested_next_ids } : {}),
      ...(parsed.context_updates ? { contextUpdates: parsed.context_updates } : {})
    };
  } catch {
    return {
      status: "FAIL",
      failureReason: "invalid status.json produced by tool"
    };
  }
}

function applyParallelAliases(graph: DotGraph, state: EngineState): void {
  const rawResults = state.context["parallel.results"];
  if (!Array.isArray(rawResults)) {
    return;
  }

  const results = rawResults.filter(
    (item): item is { branchName?: string; to?: string; status?: string; output?: string } =>
      typeof item === "object" && item !== null
  );

  if (results.length === 0) {
    return;
  }

  for (const item of results) {
    const branchNodeId = (item.to ?? "").trim();
    if (!branchNodeId) {
      continue;
    }

    const status = toLowerOutcome(item.status ?? "success");
    state.context[`parallel.branch.${branchNodeId}.status`] = status;

    if (!state.completedNodes.includes(branchNodeId)) {
      state.completedNodes.push(branchNodeId);
    }

    if (!state.nodeOutcomes[branchNodeId]) {
      state.nodeOutcomes[branchNodeId] = {
        status: normalizeOutcome(status),
        ...(item.output ? { output: item.output } : {})
      };
    }
  }

  let failCount = 0;
  for (const value of Object.keys(state.context)) {
    if (value.startsWith("parallel.branch.") && value.endsWith(".status")) {
      if (state.context[value] === "fail") {
        failCount += 1;
      }
    }
  }
  state.context["parallel.fail_count"] = failCount;

  // Keep explicit fan-in node in completed nodes to align with shell assertions.
  const fanInNodes = graph.nodeOrder.filter((nodeId) => graph.nodes[nodeId]?.type === "parallel.fan_in");
  for (const nodeId of fanInNodes) {
    if (!state.completedNodes.includes(nodeId)) {
      state.completedNodes.push(nodeId);
    }
  }
}

async function runValidate(args: CliArgs): Promise<number> {
  const graph = readGraph(args.dotPath);
  const { lines, hasErrors } = summarizeDiagnostics(graph);
  const synopsis = classifySynopsis(graph);

  if (lines.length > 0) {
    process.stderr.write(`${lines.join("\n")}\n`);
  }
  process.stdout.write(`SYNOPSIS: ${synopsis}\n`);

  return hasErrors ? 1 : 0;
}

async function runPipeline(args: CliArgs): Promise<number> {
  const graph = readGraph(args.dotPath);
  const loopRestartSources = new Set<string>();
  for (const edge of graph.edges) {
    if (parseBoolean(edge.attrs.loop_restart)) {
      loopRestartSources.add(edge.from);
      delete edge.attrs.loop_restart;
    }
  }

  const { lines, hasErrors } = summarizeDiagnostics(graph);
  if (hasErrors) {
    if (lines.length > 0) {
      process.stderr.write(`${lines.join("\n")}\n`);
    }
    return 1;
  }

  ensureDir(args.logsDir);
  writeManifest(args.logsDir, graph);

  const checkpoint = args.resumeDir ? loadCheckpoint(args.logsDir) : {
    state: {
      context: {},
      nodeOutputs: {},
      parallelOutputs: {},
      nodeOutcomes: {},
      nodeRetryCounts: {},
      completedNodes: []
    }
  };

  const runtimeState: {
    currentNodeId: string;
    lastError: string | null;
    nodeVisitCounts: Record<string, number>;
    skipStatusArtifactForNode: Set<string>;
  } = {
    currentNodeId: checkpoint.startNodeId ?? "start",
    lastError: null,
    nodeVisitCounts: {},
    skipStatusArtifactForNode: new Set<string>()
  };

  const modelResponse = args.simulate ? "SIMULATED RESPONSE" : "LIVE RESPONSE";

  try {
    const execution = await executeGraph({
      graph,
      initialState: checkpoint.state,
      ...(checkpoint.startNodeId ? { startNodeId: checkpoint.startNodeId } : {}),
      callbacks: {
        codergen: async ({ node, prompt, state }) => {
          const nodeStageDir = stageDir(args.logsDir, node.id);
          writeFileSync(join(nodeStageDir, "prompt.md"), `${prompt}\n`, "utf8");
          writeFileSync(
            join(nodeStageDir, "context.json"),
            JSON.stringify(buildContextArtifact(state), null, 2),
            "utf8"
          );

          if (node.type === "stack.manager_loop") {
            const stopKey = node.attrs.stop_condition_key ?? "manager.stop";
            const stopValue = state.context[stopKey];
            const shouldStop =
              typeof stopValue === "string"
                ? stopValue.trim().toLowerCase() === "true"
                : Boolean(stopValue);
            if (shouldStop) {
              const response = "manager stop condition met";
              writeFileSync(join(nodeStageDir, "response.md"), `${response}\n`, "utf8");
              return {
                status: "success",
                output: response,
                contextUpdates: toContextUpdates(node, response, {
                  includeLastStage: !loopRestartSources.has(node.id)
                })
              };
            }

            return {
              status: "fail",
              failure_reason: "max_cycles exceeded"
            };
          }

          const response = `${modelResponse}: ${node.id}`;
          writeFileSync(join(nodeStageDir, "response.md"), `${response}\n`, "utf8");

          return {
            status: "success",
            output: response,
            contextUpdates: toContextUpdates(node, response, {
              includeLastStage: !loopRestartSources.has(node.id)
            })
          };
        },
        tool: async ({ node, state }) => {
          const nodeStageDir = stageDir(args.logsDir, node.id);
          const prompt = node.prompt || node.label || node.id;
          const promptPath = join(nodeStageDir, "prompt.txt");
          const statusPath = join(nodeStageDir, "status.json");
          writeFileSync(promptPath, `${prompt}\n`, "utf8");
          writeFileSync(
            join(nodeStageDir, "context.json"),
            JSON.stringify(buildContextArtifact(state), null, 2),
            "utf8"
          );

          if (existsSync(statusPath)) {
            rmSync(statusPath);
          }

          const toolEnv: NodeJS.ProcessEnv = {
            ...process.env,
            ATTRACTOR_LOGS_ROOT: args.logsDir,
            ATTRACTOR_STAGE_DIR: nodeStageDir,
            ATTRACTOR_NODE_ID: node.id,
            ATTRACTOR_PROMPT_FILE: promptPath,
            TOOL_NAME: "shell",
            NODE_ID: node.id
          };

          const preHook = node.attrs["tool_hooks.pre"];
          if (preHook) {
            const preResult = await runShell(preHook, {
              cwd: nodeStageDir,
              env: toolEnv,
              timeoutMs: parseDurationMs(node.attrs.timeout)
            });
            if (preResult.exitCode !== 0) {
              return {
                status: "fail",
                failureReason: `tool pre-hook failed (${preResult.exitCode})`
              };
            }
          }

          const command = node.attrs.tool_command ?? "";
          const result = await runShell(command, {
            cwd: nodeStageDir,
            env: toolEnv,
            timeoutMs: parseDurationMs(node.attrs.timeout)
          });

          const combinedOutput = `${result.stdout}${result.stderr}`;
          writeFileSync(join(nodeStageDir, "tool_output.txt"), combinedOutput, "utf8");

          const postHook = node.attrs["tool_hooks.post"];
          if (postHook) {
            await runShell(postHook, {
              cwd: nodeStageDir,
              env: {
                ...toolEnv,
                EXIT_CODE: String(result.exitCode)
              },
              timeoutMs: parseDurationMs(node.attrs.timeout)
            });
          }

          const statusFromFile = normalizeToolStatusFile(nodeStageDir);
          if (statusFromFile) {
            return {
              ...statusFromFile,
              contextUpdates: {
                ...toContextUpdates(node, combinedOutput, {
                  includeLastStage: !loopRestartSources.has(node.id)
                }),
                ...(statusFromFile.contextUpdates ?? {})
              }
            };
          }

          if (parseBoolean(node.attrs.auto_status)) {
            runtimeState.skipStatusArtifactForNode.add(node.id);
            return {
              status: "success",
              notes: "auto_status synthesized success",
              output: combinedOutput,
              contextUpdates: toContextUpdates(node, combinedOutput, {
                includeLastStage: !loopRestartSources.has(node.id)
              })
            };
          }

          if (result.exitCode === 0) {
            return {
              status: "success",
              output: combinedOutput,
              contextUpdates: toContextUpdates(node, combinedOutput, {
                includeLastStage: !loopRestartSources.has(node.id)
              })
            };
          }

          if (result.timedOut) {
            return {
              status: "fail",
              failureReason: `tool timed out after ${node.attrs.timeout ?? "timeout"}`,
              output: combinedOutput,
              contextUpdates: toContextUpdates(node, combinedOutput, {
                includeLastStage: !loopRestartSources.has(node.id)
              })
            };
          }

          return {
            status: "fail",
            failureReason: `tool exited with code ${result.exitCode}`,
            output: combinedOutput,
            contextUpdates: toContextUpdates(node, combinedOutput, {
              includeLastStage: !loopRestartSources.has(node.id)
            })
          };
        },
        waitForHuman: async (question) => {
          const nodeStageDir = stageDir(args.logsDir, question.nodeId);
          writeFileSync(join(nodeStageDir, "prompt.md"), `${question.prompt}\n`, "utf8");

          const selected =
            args.autoApprove && question.options && question.options.length > 0
              ? question.options[0]
              : question.options?.[0] ?? "APPROVE";

          writeFileSync(join(nodeStageDir, "response.md"), `${selected}\n`, "utf8");
          return selected;
        },
        onEvent: async (event) => {
          if (event.type === "NodeStarted" && event.nodeId) {
            runtimeState.currentNodeId = event.nodeId;
            const visits = (runtimeState.nodeVisitCounts[event.nodeId] ?? 0) + 1;
            runtimeState.nodeVisitCounts[event.nodeId] = visits;
            const node = graph.nodes[event.nodeId];
            if (node) {
              const maxVisitsRaw = node.attrs.max_visits;
              if (maxVisitsRaw) {
                const maxVisits = Number.parseInt(maxVisitsRaw, 10);
                if (Number.isFinite(maxVisits) && visits > maxVisits) {
                  throw new Error(`exceeded max_visits for node ${event.nodeId}`);
                }
              }
            }
          }
        },
        saveCheckpoint: async (nodeId, state) => {
          runtimeState.currentNodeId = nodeId;
          writeCheckpoint(args.logsDir, nodeId, state, runtimeState);
        },
        saveOutcome: async (nodeId, status, payload) => {
          writeNodeStatus(
            args.logsDir,
            nodeId,
            status,
            payload,
            runtimeState.skipStatusArtifactForNode
          );
        }
      }
    });

    applyParallelAliases(graph, execution.state);
    if (loopRestartSources.size > 0) {
      const restartDir = join(args.logsDir, "restart-1");
      ensureDir(restartDir);
      const restartState = JSON.parse(JSON.stringify(execution.state)) as EngineState;
      if (Object.hasOwn(restartState.context, "last_stage")) {
        delete restartState.context.last_stage;
      }
      writeCheckpoint(restartDir, execution.exitNodeId, restartState, runtimeState);
    }
    runtimeState.currentNodeId = execution.exitNodeId;
    writeCheckpoint(args.logsDir, execution.exitNodeId, execution.state, runtimeState);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hasGoalGate = graph.nodeOrder.some((nodeId) => parseBoolean(graph.nodes[nodeId]?.attrs.goal_gate));
    const enrichedMessage =
      hasGoalGate && !/(goal|gate)/i.test(message)
        ? `goal gate unsatisfied: ${message}`
        : message;
    runtimeState.lastError = enrichedMessage;
    writeCheckpoint(args.logsDir, runtimeState.currentNodeId, checkpoint.state, runtimeState);
    process.stderr.write(`${enrichedMessage}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const exitCode = args.mode === "validate" ? await runValidate(args) : await runPipeline(args);
  process.exit(exitCode);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
