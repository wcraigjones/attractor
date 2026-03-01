import { resolve, sep } from "node:path";

import type { DotNode, NodeOutcome } from "./engine/index.js";

export interface RunCommandOptions {
  timeoutMs?: number;
}

export type RunCommandFn = (
  command: string,
  args: string[],
  cwd: string,
  options?: RunCommandOptions
) => Promise<string>;

type ToolExecutionResult =
  | {
      kind: "noop";
      output: string;
      tool: string | null;
    }
  | {
      kind: "command_success";
      output: string;
      tool: string | null;
      command: string;
      cwd: string;
      timeoutMs: number | null;
      outputPreview: string;
    }
  | {
      kind: "command_failure";
      output: NodeOutcome;
      tool: string | null;
      command: string;
      cwd: string;
      timeoutMs: number | null;
      outputPreview: string;
    };

export interface ExecuteToolNodeArgs {
  node: DotNode;
  workDir: string;
  runCommand: RunCommandFn;
  defaultOutput: string;
}

const TOOL_OUTPUT_PREVIEW_MAX_CHARS = 4_000;
const TOOL_TIMEOUT_DEFAULT_MS = 15 * 60 * 1_000;
const TOOL_TIMEOUT_MAX_MS = 60 * 60 * 1_000;

function truncateToolOutput(value: string, maxChars = TOOL_OUTPUT_PREVIEW_MAX_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated]`;
}

function normalizeToolName(node: DotNode): string | null {
  const raw = (node.attrs.tool ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function resolveToolCommand(node: DotNode): string | null {
  const raw = (node.attrs.command ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function resolveToolCwd(workDir: string, node: DotNode): string {
  const rawCwd = (node.attrs.cwd ?? "").trim();
  if (rawCwd.length === 0) {
    return workDir;
  }

  const root = resolve(workDir);
  const candidate = resolve(root, rawCwd);
  if (candidate === root || candidate.startsWith(`${root}${sep}`)) {
    return candidate;
  }
  throw new Error(`Tool node ${node.id} requested cwd outside repository: ${rawCwd}`);
}

function parseTimeoutMs(node: DotNode): number | null {
  const raw =
    (node.attrs.timeout_ms ?? "").trim() ||
    (node.attrs.timeoutMs ?? "").trim() ||
    (node.attrs.command_timeout_ms ?? "").trim() ||
    (node.attrs.commandTimeoutMs ?? "").trim();

  if (raw.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, TOOL_TIMEOUT_MAX_MS);
}

function commandOutputFromError(error: unknown): string {
  const payload = error as {
    stdout?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
  const combined = `${stdout}${stderr}`.trim();
  if (combined.length > 0) {
    return combined;
  }
  return typeof payload.message === "string" ? payload.message : String(error);
}

export async function executeToolNode(args: ExecuteToolNodeArgs): Promise<ToolExecutionResult> {
  const tool = normalizeToolName(args.node);
  const command = resolveToolCommand(args.node);
  if (!command) {
    return {
      kind: "noop",
      output: args.node.attrs.output ?? args.defaultOutput,
      tool
    };
  }

  let cwd: string;
  try {
    cwd = resolveToolCwd(args.workDir, args.node);
  } catch (error) {
    const outputPreview = truncateToolOutput(
      error instanceof Error ? error.message : String(error)
    );
    return {
      kind: "command_failure",
      tool,
      command,
      cwd: args.workDir,
      timeoutMs: null,
      outputPreview,
      output: {
        status: "FAIL",
        failureReason: `Tool command preflight failed for node ${args.node.id}`,
        notes: outputPreview
      }
    };
  }

  const timeoutMs = parseTimeoutMs(args.node) ?? TOOL_TIMEOUT_DEFAULT_MS;
  try {
    const output = await args.runCommand("bash", ["-lc", command], cwd, { timeoutMs });
    const normalized = output.trim().length > 0 ? output : args.node.attrs.output ?? args.defaultOutput;
    return {
      kind: "command_success",
      output: normalized,
      tool,
      command,
      cwd,
      timeoutMs,
      outputPreview: truncateToolOutput(normalized)
    };
  } catch (error) {
    const outputPreview = truncateToolOutput(commandOutputFromError(error));
    return {
      kind: "command_failure",
      output: {
        status: "FAIL",
        failureReason: `Tool command failed for node ${args.node.id}`,
        notes: outputPreview
      },
      tool,
      command,
      cwd,
      timeoutMs,
      outputPreview
    };
  }
}
