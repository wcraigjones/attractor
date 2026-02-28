import { evaluateCondition } from "./condition.js";
import type {
  DotEdge,
  DotGraph,
  DotNode,
  EngineCallbacks,
  EngineState,
  ExecuteGraphInput,
  ExecuteGraphResult,
  HumanQuestion,
  ToolInvocation
} from "./types.js";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getStartNodeId(graph: DotGraph): string {
  const start = graph.nodeOrder.find((id) => graph.nodes[id]?.type === "start");
  if (!start) {
    throw new Error("Graph does not contain a start node");
  }
  return start;
}

function outgoingEdges(graph: DotGraph, nodeId: string): DotEdge[] {
  return graph.edges
    .filter((edge) => edge.from === nodeId)
    .sort((a, b) => b.weight - a.weight);
}

function selectNextEdge(graph: DotGraph, nodeId: string, state: EngineState): DotEdge | null {
  const candidates = outgoingEdges(graph, nodeId);
  for (const candidate of candidates) {
    if (evaluateCondition(candidate.condition, state)) {
      return candidate;
    }
  }
  return null;
}

async function emit(callbacks: EngineCallbacks, type: string, nodeId?: string, payload?: unknown): Promise<void> {
  await callbacks.onEvent?.({ type, nodeId, payload });
}

async function saveOutcome(
  callbacks: EngineCallbacks,
  nodeId: string,
  status: string,
  payload: unknown,
  attempt: number
): Promise<void> {
  await callbacks.saveOutcome?.(nodeId, status, payload, attempt);
}

function modelPrompt(node: DotNode, state: EngineState): string {
  const prompt = node.prompt || node.label || node.id;
  const statePayload = JSON.stringify(
    {
      context: state.context,
      nodeOutputs: state.nodeOutputs,
      parallelOutputs: state.parallelOutputs
    },
    null,
    2
  );
  return `${prompt}\n\nWorkflow state:\n${statePayload}`;
}

function parseOptions(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseDurationMs(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.trim().match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    return undefined;
  }
  const value = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "ms";
  if (unit === "ms") return value;
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60_000;
  if (unit === "h") return value * 3_600_000;
  return value * 86_400_000;
}

function normalizeNodeOutput(value: string | undefined): string {
  return value ?? "";
}

async function executeNodeAttempt(node: DotNode, state: EngineState, callbacks: EngineCallbacks): Promise<string> {
  if (node.type === "start" || node.type === "exit" || node.type === "conditional" || node.type === "parallel.fan_in") {
    return "";
  }

  if (node.type === "codergen") {
    const output = await callbacks.codergen({
      node,
      prompt: modelPrompt(node, state),
      state
    });
    return normalizeNodeOutput(output);
  }

  if (node.type === "tool") {
    if (!callbacks.tool) {
      throw new Error(`Tool handler is not configured for node ${node.id}`);
    }
    const output = await callbacks.tool({ node, state } satisfies ToolInvocation);
    return normalizeNodeOutput(output);
  }

  if (node.type === "wait.human") {
    if (!callbacks.waitForHuman) {
      throw new Error(`waitForHuman callback is not configured for node ${node.id}`);
    }
    const question: HumanQuestion = {
      nodeId: node.id,
      prompt: node.prompt || node.label || node.id,
      options: parseOptions(node.attrs.options),
      timeoutMs: parseDurationMs(node.attrs.timeout)
    };
    return normalizeNodeOutput(await callbacks.waitForHuman(question));
  }

  if (node.type === "stack.manager_loop") {
    const output = await callbacks.codergen({
      node,
      prompt: modelPrompt(node, state),
      state
    });
    return normalizeNodeOutput(output);
  }

  if (node.type === "custom") {
    const handlerName = node.attrs.type ?? "custom";
    const handler = callbacks.customHandlers?.[handlerName];
    if (!handler) {
      throw new Error(`No custom handler registered for node type ${handlerName}`);
    }
    return normalizeNodeOutput(await handler(node, state));
  }

  throw new Error(`Unsupported node type ${node.type}`);
}

async function executeNode(node: DotNode, state: EngineState, callbacks: EngineCallbacks): Promise<string> {
  const maxRetries = Number.parseInt(node.attrs.max_retries ?? "0", 10) || 0;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    await emit(callbacks, "NodeStarted", node.id, { type: node.type, attempt });
    try {
      const output = await executeNodeAttempt(node, state, callbacks);
      if (output) {
        state.nodeOutputs[node.id] = output;
      }
      await saveOutcome(callbacks, node.id, "SUCCESS", { output }, attempt);
      await emit(callbacks, "NodeCompleted", node.id, { type: node.type, attempt });
      return output;
    } catch (error) {
      await saveOutcome(
        callbacks,
        node.id,
        "FAILED",
        { message: error instanceof Error ? error.message : String(error) },
        attempt
      );
      await emit(callbacks, "NodeFailed", node.id, {
        type: node.type,
        attempt,
        message: error instanceof Error ? error.message : String(error)
      });
      if (attempt > maxRetries) {
        throw error;
      }
    }
  }

  return "";
}

async function executeBranchToFanIn(
  graph: DotGraph,
  startNodeId: string,
  fanInNodeId: string,
  baseState: EngineState,
  callbacks: EngineCallbacks
): Promise<string> {
  const branchState = deepClone(baseState);
  const visited = new Set<string>();
  let currentNodeId = startNodeId;
  let lastOutput = "";

  while (currentNodeId !== fanInNodeId) {
    if (visited.has(currentNodeId)) {
      throw new Error(`Loop detected in parallel branch at node ${currentNodeId}`);
    }
    visited.add(currentNodeId);

    const node = graph.nodes[currentNodeId];
    if (!node) {
      throw new Error(`Parallel branch node not found: ${currentNodeId}`);
    }
    if (node.type === "parallel") {
      throw new Error(`Nested parallel nodes are not supported in branch execution (${node.id})`);
    }

    const output = await executeNode(node, branchState, callbacks);
    if (output.trim().length > 0) {
      lastOutput = output;
    }

    if (node.type === "exit") {
      break;
    }

    const next = selectNextEdge(graph, node.id, branchState);
    if (!next) {
      throw new Error(`No eligible outgoing edge from branch node ${node.id}`);
    }
    currentNodeId = next.to;
  }

  return lastOutput;
}

function findFanInNodeId(graph: DotGraph, branchStart: string, state: EngineState): string {
  const visited = new Set<string>();
  let currentNodeId = branchStart;
  let guard = 0;

  while (guard < 256) {
    guard += 1;
    const node = graph.nodes[currentNodeId];
    if (!node) {
      throw new Error(`Node not found while resolving fan-in: ${currentNodeId}`);
    }
    if (node.type === "parallel.fan_in") {
      return node.id;
    }
    if (visited.has(currentNodeId)) {
      throw new Error(`Loop detected while resolving fan-in from ${branchStart}`);
    }
    visited.add(currentNodeId);

    const next = selectNextEdge(graph, node.id, state);
    if (!next) {
      throw new Error(`No eligible edge found while resolving fan-in from ${branchStart}`);
    }
    currentNodeId = next.to;
  }

  throw new Error(`Failed to resolve fan-in for branch ${branchStart}`);
}

async function executeParallelNode(
  graph: DotGraph,
  node: DotNode,
  state: EngineState,
  callbacks: EngineCallbacks
): Promise<string> {
  const branches = outgoingEdges(graph, node.id);
  if (branches.length === 0) {
    throw new Error(`Parallel node ${node.id} has no outgoing edges`);
  }

  const fanInIds = branches.map((edge) => findFanInNodeId(graph, edge.to, state));
  const uniqueFanIns = [...new Set(fanInIds)];
  if (uniqueFanIns.length !== 1) {
    throw new Error(`Parallel node ${node.id} must converge to a single fan-in node`);
  }
  const fanInNodeId = uniqueFanIns[0] ?? "";

  await emit(callbacks, "ParallelStarted", node.id, {
    branches: branches.map((edge) => ({ from: edge.from, to: edge.to }))
  });

  const results = await Promise.all(
    branches.map(async (edge, index) => {
      const branchName = edge.label || `branch-${index + 1}`;
      const output = await executeBranchToFanIn(graph, edge.to, fanInNodeId, state, callbacks);
      return { branchName, output };
    })
  );

  state.parallelOutputs[node.id] = Object.fromEntries(results.map((item) => [item.branchName, item.output]));

  await emit(callbacks, "ParallelCompleted", node.id, {
    fanInNodeId,
    branchCount: results.length
  });

  return fanInNodeId;
}

export async function executeGraph(input: ExecuteGraphInput): Promise<ExecuteGraphResult> {
  const state: EngineState =
    input.initialState ?? {
      context: {},
      nodeOutputs: {},
      parallelOutputs: {}
    };

  let currentNodeId = input.startNodeId ?? getStartNodeId(input.graph);
  if (!input.graph.nodes[currentNodeId]) {
    throw new Error(`Start node not found: ${currentNodeId}`);
  }
  const maxSteps = input.maxSteps ?? 1000;

  for (let step = 0; step < maxSteps; step += 1) {
    const node = input.graph.nodes[currentNodeId];
    if (!node) {
      throw new Error(`Node not found: ${currentNodeId}`);
    }

    await input.callbacks.saveCheckpoint?.(currentNodeId, state);

    let nextOverride: string | null = null;
    if (node.type === "parallel") {
      nextOverride = await executeParallelNode(input.graph, node, state, input.callbacks);
      await saveOutcome(input.callbacks, node.id, "SUCCESS", { fanInNodeId: nextOverride }, 1);
    } else {
      await executeNode(node, state, input.callbacks);
    }

    if (node.type === "exit") {
      return {
        state,
        exitNodeId: node.id
      };
    }

    if (nextOverride) {
      currentNodeId = nextOverride;
      continue;
    }

    const nextEdge = selectNextEdge(input.graph, node.id, state);
    if (!nextEdge) {
      throw new Error(`No eligible outgoing edge from node ${node.id}`);
    }
    currentNodeId = nextEdge.to;
  }

  throw new Error(`Graph execution exceeded max steps (${maxSteps})`);
}
