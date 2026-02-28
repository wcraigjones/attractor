import { evaluateCondition } from "./condition.js";
import type {
  DotEdge,
  DotGraph,
  DotNode,
  EngineCallbacks,
  EngineState,
  ExecuteGraphInput,
  ExecuteGraphResult,
  HandlerResultLike,
  HumanQuestion,
  NodeOutcome,
  OutcomeStatus,
  ToolInvocation
} from "./types.js";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseFloatNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function normalizeStatus(raw: string | undefined): OutcomeStatus {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "success") return "SUCCESS";
  if (normalized === "partial_success" || normalized === "partial-success") {
    return "PARTIAL_SUCCESS";
  }
  if (normalized === "retry") return "RETRY";
  if (normalized === "fail" || normalized === "failed") return "FAIL";
  if (normalized === "skipped") return "SKIPPED";
  return "SUCCESS";
}

function normalizeLabel(label: string): string {
  return label
    .trim()
    .replace(/^\[[A-Za-z0-9]\]\s*/, "")
    .replace(/^[A-Za-z0-9]\)\s*/, "")
    .replace(/^[A-Za-z0-9]\s*-\s*/, "")
    .trim()
    .toLowerCase();
}

function isSuccessStatus(status: OutcomeStatus): boolean {
  return status === "SUCCESS" || status === "PARTIAL_SUCCESS";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getStartNodeId(graph: DotGraph): string {
  const byType = graph.nodeOrder.find((id) => graph.nodes[id]?.type === "start");
  if (byType) {
    return byType;
  }
  const byName = graph.nodeOrder.find((id) => id.toLowerCase() === "start");
  if (byName) {
    return byName;
  }
  throw new Error("Graph does not contain a start node");
}

function isExitNode(node: DotNode): boolean {
  return (
    node.type === "exit" ||
    node.id.toLowerCase() === "exit" ||
    node.id.toLowerCase() === "end"
  );
}

function outgoingEdges(graph: DotGraph, nodeId: string): DotEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId);
}

function bestByWeightThenLexical(edges: DotEdge[]): DotEdge | null {
  if (edges.length === 0) {
    return null;
  }
  const sorted = [...edges].sort((a, b) => {
    if (a.weight !== b.weight) {
      return b.weight - a.weight;
    }
    return a.to.localeCompare(b.to);
  });
  return sorted[0] ?? null;
}

function eligibleEdge(edge: DotEdge, state: EngineState, outcome: NodeOutcome): boolean {
  if (!edge.condition.trim()) {
    return true;
  }
  return evaluateCondition(edge.condition, state, outcome);
}

function selectConditionMatchedEdge(
  graph: DotGraph,
  nodeId: string,
  state: EngineState,
  outcome: NodeOutcome
): DotEdge | null {
  const matched = outgoingEdges(graph, nodeId).filter((edge) => {
    if (!edge.condition.trim()) {
      return false;
    }
    return evaluateCondition(edge.condition, state, outcome);
  });
  return bestByWeightThenLexical(matched);
}

function selectNextEdge(
  graph: DotGraph,
  nodeId: string,
  state: EngineState,
  outcome: NodeOutcome
): DotEdge | null {
  const edges = outgoingEdges(graph, nodeId);
  if (edges.length === 0) {
    return null;
  }

  const conditionMatched = selectConditionMatchedEdge(graph, nodeId, state, outcome);
  if (conditionMatched) {
    return conditionMatched;
  }

  const preferredLabel =
    outcome.preferredLabel ??
    (typeof state.context.preferred_label === "string"
      ? state.context.preferred_label
      : undefined);
  if (preferredLabel) {
    const normalizedPreference = normalizeLabel(preferredLabel);
    for (const edge of edges) {
      if (!eligibleEdge(edge, state, outcome)) {
        continue;
      }
      if (normalizeLabel(edge.label) === normalizedPreference) {
        return edge;
      }
    }
  }

  const suggestedNextIds = outcome.suggestedNextIds ?? [];
  for (const suggestedId of suggestedNextIds) {
    for (const edge of edges) {
      if (!eligibleEdge(edge, state, outcome)) {
        continue;
      }
      if (edge.to === suggestedId) {
        return edge;
      }
    }
  }

  const unconditional = edges.filter((edge) => !edge.condition.trim());
  const unconditionalBest = bestByWeightThenLexical(unconditional);
  if (unconditionalBest) {
    return unconditionalBest;
  }

  return bestByWeightThenLexical(edges);
}

function retryTargetForNode(node: DotNode, graph: DotGraph): string | null {
  const candidates = [
    node.attrs.retry_target,
    node.attrs.fallback_retry_target,
    graph.graphAttrs.retry_target,
    graph.graphAttrs.fallback_retry_target
  ].filter((item): item is string => Boolean(item && item.trim().length > 0));

  for (const candidate of candidates) {
    if (graph.nodes[candidate]) {
      return candidate;
    }
  }
  return null;
}

function goalGateRetryTarget(failedNode: DotNode, graph: DotGraph): string | null {
  const candidates = [
    failedNode.attrs.retry_target,
    failedNode.attrs.fallback_retry_target,
    graph.graphAttrs.retry_target,
    graph.graphAttrs.fallback_retry_target
  ].filter((item): item is string => Boolean(item && item.trim().length > 0));

  for (const candidate of candidates) {
    if (graph.nodes[candidate]) {
      return candidate;
    }
  }
  return null;
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

function modelPrompt(node: DotNode, state: EngineState): string {
  const prompt = node.prompt || node.label || node.id;
  const statePayload = JSON.stringify(
    {
      context: state.context,
      nodeOutputs: state.nodeOutputs,
      parallelOutputs: state.parallelOutputs,
      completedNodes: state.completedNodes
    },
    null,
    2
  );
  return `${prompt}\n\nWorkflow state:\n${statePayload}`;
}

function normalizeOutcomeLike(result: HandlerResultLike | NodeOutcome): NodeOutcome {
  const value = result as HandlerResultLike;
  const preferredLabel =
    value.preferredLabel ??
    value.preferred_label ??
    value.preferred_next_label;
  const suggestedNextIds =
    value.suggestedNextIds ??
    value.suggested_next_ids ??
    [];
  const contextUpdates = value.contextUpdates ?? value.context_updates;
  const failureReason = value.failureReason ?? value.failure_reason;

  return {
    status: normalizeStatus(value.status ?? value.outcome),
    ...(preferredLabel ? { preferredLabel } : {}),
    ...(suggestedNextIds.length > 0 ? { suggestedNextIds } : {}),
    ...(contextUpdates ? { contextUpdates } : {}),
    ...(value.notes ? { notes: value.notes } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(value.output ? { output: value.output } : {})
  };
}

function normalizeHandlerResult(
  result: string | NodeOutcome | HandlerResultLike | undefined,
  fallback: NodeOutcome
): NodeOutcome {
  if (typeof result === "string") {
    return {
      ...fallback,
      status: "SUCCESS",
      output: result
    };
  }
  if (!result || typeof result !== "object") {
    return fallback;
  }
  return {
    ...fallback,
    ...normalizeOutcomeLike(result)
  };
}

function applyContextUpdates(state: EngineState, node: DotNode, outcome: NodeOutcome): void {
  if (outcome.contextUpdates) {
    state.context = {
      ...state.context,
      ...outcome.contextUpdates
    };
  }

  if (outcome.output && outcome.output.trim().length > 0) {
    state.nodeOutputs[node.id] = outcome.output;
  }

  state.context.outcome = outcome.status.toLowerCase();
  if (outcome.preferredLabel) {
    state.context.preferred_label = outcome.preferredLabel;
  }
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    state.context.suggested_next_ids = outcome.suggestedNextIds;
  }
  state.context.current_node = node.id;

  state.nodeOutcomes[node.id] = outcome;
  if (!state.completedNodes.includes(node.id)) {
    state.completedNodes.push(node.id);
  }
}

function serializableOutcome(outcome: NodeOutcome): Record<string, unknown> {
  return {
    status: outcome.status,
    preferredLabel: outcome.preferredLabel ?? null,
    suggestedNextIds: outcome.suggestedNextIds ?? [],
    contextUpdates: outcome.contextUpdates ?? {},
    notes: outcome.notes ?? null,
    failureReason: outcome.failureReason ?? null,
    output: outcome.output ?? null
  };
}

function shouldRetryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("econnreset") ||
    message.includes("connection reset") ||
    message.includes("rate limit") ||
    message.includes("429")
  ) {
    return true;
  }

  const status = (error as { status?: number; statusCode?: number })?.status ??
    (error as { status?: number; statusCode?: number })?.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    if (status === 400 || status === 401 || status === 403) return false;
  }

  return false;
}

function delayForAttempt(attempt: number, node: DotNode): number {
  const initialDelayMs = parseInteger(node.attrs.retry_initial_delay_ms, 200);
  const backoffFactor = parseFloatNumber(node.attrs.retry_backoff_factor, 2.0);
  const maxDelayMs = parseInteger(node.attrs.retry_max_delay_ms, 60_000);
  const jitter = parseBoolean(node.attrs.retry_jitter, true);
  let delay = initialDelayMs * Math.pow(backoffFactor, Math.max(0, attempt - 1));
  delay = Math.min(delay, maxDelayMs);
  if (jitter) {
    delay *= 0.5 + Math.random();
  }
  return Math.max(0, Math.floor(delay));
}

function maxAttempts(node: DotNode, graph: DotGraph): number {
  const maxRetries = node.attrs.max_retries
    ? parseInteger(node.attrs.max_retries, 0)
    : parseInteger(graph.graphAttrs.default_max_retry, 50);
  return Math.max(1, maxRetries + 1);
}

async function emit(
  callbacks: EngineCallbacks,
  type: string,
  nodeId?: string,
  payload?: unknown
): Promise<void> {
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

async function executeNodeAttempt(
  node: DotNode,
  graph: DotGraph,
  state: EngineState,
  callbacks: EngineCallbacks
): Promise<NodeOutcome> {
  if (node.type === "start") {
    return { status: "SUCCESS", notes: "start node" };
  }
  if (node.type === "exit") {
    return { status: "SUCCESS", notes: "exit node" };
  }
  if (node.type === "conditional" || node.type === "parallel.fan_in") {
    return { status: "SUCCESS", notes: `pass-through ${node.type}` };
  }

  if (node.type === "codergen" || node.type === "stack.manager_loop") {
    const result = await callbacks.codergen({
      node,
      prompt: modelPrompt(node, state),
      state
    });
    return normalizeHandlerResult(result, { status: "SUCCESS" });
  }

  if (node.type === "tool") {
    if (!callbacks.tool) {
      return {
        status: "FAIL",
        failureReason: `Tool handler is not configured for node ${node.id}`
      };
    }
    const result = await callbacks.tool({ node, state } satisfies ToolInvocation);
    return normalizeHandlerResult(result, { status: "SUCCESS" });
  }

  if (node.type === "wait.human") {
    if (!callbacks.waitForHuman) {
      return {
        status: "FAIL",
        failureReason: `waitForHuman callback is not configured for node ${node.id}`
      };
    }

    const edges = outgoingEdges(graph, node.id);
    if (edges.length === 0) {
      return {
        status: "FAIL",
        failureReason: `No outgoing edges for human gate node ${node.id}`
      };
    }

    const choices = edges.map((edge) => {
      const label = edge.label || edge.to;
      const keyFromBracket = label.match(/^\[([A-Za-z0-9])\]\s*/)?.[1];
      const keyFromParen = label.match(/^([A-Za-z0-9])\)\s*/)?.[1];
      const keyFromDash = label.match(/^([A-Za-z0-9])\s*-\s*/)?.[1];
      const key = (keyFromBracket ?? keyFromParen ?? keyFromDash ?? label[0] ?? "")
        .toUpperCase();
      return {
        key,
        label,
        to: edge.to
      };
    });

    const question: HumanQuestion = {
      nodeId: node.id,
      prompt: node.prompt || node.label || node.id,
      options: choices.map((choice) => `[${choice.key}] ${choice.label}`),
      timeoutMs: parseDurationMs(node.attrs.timeout)
    };
    const result = await callbacks.waitForHuman(question);
    const normalized = normalizeHandlerResult(result, { status: "SUCCESS" });

    if (typeof result === "object" && result && "status" in result) {
      return normalized;
    }

    const rawAnswer = typeof result === "string" ? result.trim() : "";
    const defaultChoiceTarget = node.attrs["human.default_choice"]?.trim();

    if (!rawAnswer || rawAnswer.toUpperCase() === "TIMEOUT") {
      if (defaultChoiceTarget) {
        const fallbackChoice = choices.find((choice) => choice.to === defaultChoiceTarget);
        if (fallbackChoice) {
          return {
            status: "SUCCESS",
            preferredLabel: fallbackChoice.label,
            suggestedNextIds: [fallbackChoice.to],
            contextUpdates: {
              "human.gate.selected": fallbackChoice.key,
              "human.gate.label": fallbackChoice.label,
              "human.gate.target": fallbackChoice.to
            },
            notes: "human timeout, default choice selected"
          };
        }
      }
      return {
        status: "RETRY",
        failureReason: "human gate timeout with no default choice"
      };
    }

    const selected =
      choices.find((choice) => choice.to === rawAnswer) ??
      choices.find((choice) => choice.label === rawAnswer) ??
      choices.find((choice) => choice.key === rawAnswer.toUpperCase()) ??
      choices[0];

    if (!selected) {
      return {
        status: "FAIL",
        failureReason: `No selectable choices for human gate node ${node.id}`
      };
    }

    const outcome: NodeOutcome = {
      status: "SUCCESS",
      preferredLabel: selected.label,
      suggestedNextIds: [selected.to],
      contextUpdates: {
        "human.gate.selected": selected.key,
        "human.gate.label": selected.label,
        "human.gate.target": selected.to
      },
      notes: "human gate response captured"
    };
    if (
      typeof result === "string" &&
      !normalized.preferredLabel &&
      !normalized.suggestedNextIds
    ) {
      return outcome;
    }
    return normalized;
  }

  if (node.type === "custom") {
    const handlerName = node.attrs.type ?? "custom";
    const handler = callbacks.customHandlers?.[handlerName];
    if (!handler) {
      return {
        status: "FAIL",
        failureReason: `No custom handler registered for node type ${handlerName}`
      };
    }
    const result = await handler(node, state);
    return normalizeHandlerResult(result, { status: "SUCCESS" });
  }

  return {
    status: "FAIL",
    failureReason: `Unsupported node type ${node.type}`
  };
}

async function executeNodeWithRetry(
  node: DotNode,
  graph: DotGraph,
  state: EngineState,
  callbacks: EngineCallbacks
): Promise<NodeOutcome> {
  const attempts = maxAttempts(node, graph);
  const allowPartial = parseBoolean(node.attrs.allow_partial, false);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await emit(callbacks, "NodeStarted", node.id, { type: node.type, attempt });

    try {
      const outcome = await executeNodeAttempt(node, graph, state, callbacks);

      await saveOutcome(
        callbacks,
        node.id,
        outcome.status,
        serializableOutcome(outcome),
        attempt
      );

      if (outcome.status === "RETRY" || outcome.status === "FAIL") {
        if (attempt < attempts) {
          const delayMs = delayForAttempt(attempt, node);
          state.nodeRetryCounts[node.id] = (state.nodeRetryCounts[node.id] ?? 0) + 1;
          await emit(callbacks, "NodeRetrying", node.id, {
            type: node.type,
            attempt,
            delayMs,
            status: outcome.status,
            reason: outcome.failureReason ?? null
          });
          await sleep(delayMs);
          continue;
        }

        if (outcome.status === "RETRY" && allowPartial) {
          const partial: NodeOutcome = {
            ...outcome,
            status: "PARTIAL_SUCCESS",
            notes: outcome.notes ?? "retries exhausted, partial accepted"
          };
          await emit(callbacks, "NodeCompleted", node.id, {
            type: node.type,
            attempt,
            status: partial.status
          });
          return partial;
        }

        await emit(callbacks, "NodeFailed", node.id, {
          type: node.type,
          attempt,
          status: outcome.status,
          reason: outcome.failureReason ?? null
        });
        return outcome;
      }

      state.nodeRetryCounts[node.id] = 0;
      await emit(callbacks, "NodeCompleted", node.id, {
        type: node.type,
        attempt,
        status: outcome.status
      });
      return outcome;
    } catch (error) {
      const retryable = shouldRetryError(error);
      const failureOutcome: NodeOutcome = {
        status: "FAIL",
        failureReason: error instanceof Error ? error.message : String(error)
      };

      await saveOutcome(
        callbacks,
        node.id,
        failureOutcome.status,
        serializableOutcome(failureOutcome),
        attempt
      );

      if (retryable && attempt < attempts) {
        const delayMs = delayForAttempt(attempt, node);
        state.nodeRetryCounts[node.id] = (state.nodeRetryCounts[node.id] ?? 0) + 1;
        await emit(callbacks, "NodeRetrying", node.id, {
          type: node.type,
          attempt,
          delayMs,
          status: "FAIL",
          reason: failureOutcome.failureReason ?? null
        });
        await sleep(delayMs);
        continue;
      }

      await emit(callbacks, "NodeFailed", node.id, {
        type: node.type,
        attempt,
        status: "FAIL",
        reason: failureOutcome.failureReason ?? null
      });
      return failureOutcome;
    }
  }

  return {
    status: "FAIL",
    failureReason: `Retry loop exhausted for node ${node.id}`
  };
}

function findUnsatisfiedGoalGate(graph: DotGraph, state: EngineState): DotNode | null {
  for (const nodeId of state.completedNodes) {
    const node = graph.nodes[nodeId];
    if (!node || !parseBoolean(node.attrs.goal_gate, false)) {
      continue;
    }
    const outcome = state.nodeOutcomes[nodeId];
    if (!outcome || !isSuccessStatus(outcome.status)) {
      return node;
    }
  }
  return null;
}

async function executeBranchToFanIn(
  graph: DotGraph,
  startNodeId: string,
  fanInNodeId: string,
  baseState: EngineState,
  callbacks: EngineCallbacks
): Promise<{ output: string; status: OutcomeStatus }> {
  const branchState = deepClone(baseState);
  const visited = new Set<string>();
  let currentNodeId = startNodeId;
  let lastOutput = "";
  let lastStatus: OutcomeStatus = "SUCCESS";

  for (let guard = 0; guard < 1024; guard += 1) {
    if (currentNodeId === fanInNodeId) {
      break;
    }
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

    const outcome = await executeNodeWithRetry(node, graph, branchState, callbacks);
    applyContextUpdates(branchState, node, outcome);
    lastStatus = outcome.status;
    if (outcome.output && outcome.output.trim().length > 0) {
      lastOutput = outcome.output;
    }

    if (isExitNode(node)) {
      break;
    }

    if (outcome.status === "FAIL") {
      const failEdge = selectConditionMatchedEdge(graph, node.id, branchState, outcome);
      if (failEdge) {
        currentNodeId = failEdge.to;
        continue;
      }
      const retryTarget = retryTargetForNode(node, graph);
      if (retryTarget) {
        currentNodeId = retryTarget;
        continue;
      }
      break;
    }

    const next = selectNextEdge(graph, node.id, branchState, outcome);
    if (!next) {
      break;
    }
    currentNodeId = next.to;
  }

  return {
    output: lastOutput,
    status: lastStatus
  };
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

    const assumedOutcome: NodeOutcome = { status: "SUCCESS" };
    const next = selectNextEdge(graph, node.id, state, assumedOutcome);
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
): Promise<{ fanInNodeId: string; outcome: NodeOutcome }> {
  const branches = outgoingEdges(graph, node.id);
  if (branches.length === 0) {
    return {
      fanInNodeId: "",
      outcome: {
        status: "FAIL",
        failureReason: `Parallel node ${node.id} has no outgoing edges`
      }
    };
  }

  const fanInIds = branches.map((edge) => findFanInNodeId(graph, edge.to, state));
  const uniqueFanIns = [...new Set(fanInIds)];
  if (uniqueFanIns.length !== 1) {
    return {
      fanInNodeId: "",
      outcome: {
        status: "FAIL",
        failureReason: `Parallel node ${node.id} must converge to a single fan-in node`
      }
    };
  }
  const fanInNodeId = uniqueFanIns[0] ?? "";

  await emit(callbacks, "ParallelStarted", node.id, {
    branches: branches.map((edge) => ({ label: edge.label, to: edge.to }))
  });

  const results = await Promise.all(
    branches.map(async (edge, index) => {
      const branchName = edge.label || `branch-${index + 1}`;
      const result = await executeBranchToFanIn(
        graph,
        edge.to,
        fanInNodeId,
        state,
        callbacks
      );
      return {
        branchName,
        to: edge.to,
        status: result.status,
        output: result.output
      };
    })
  );

  state.parallelOutputs[node.id] = Object.fromEntries(
    results.map((item) => [item.branchName, item.output])
  );
  state.context["parallel.results"] = results;

  const successCount = results.filter((item) => isSuccessStatus(item.status)).length;
  const failCount = results.filter((item) => item.status === "FAIL").length;
  const joinPolicy = (node.attrs.join_policy ?? "wait_all").trim();
  const quorumRatio = parseFloatNumber(node.attrs.quorum_ratio, 0.5);
  const kOfN = parseInteger(node.attrs.k, Math.max(1, Math.ceil(results.length / 2)));

  let status: OutcomeStatus = "SUCCESS";
  if (joinPolicy === "first_success") {
    status = successCount > 0 ? "SUCCESS" : "FAIL";
  } else if (joinPolicy === "k_of_n") {
    status = successCount >= kOfN ? "SUCCESS" : "FAIL";
  } else if (joinPolicy === "quorum") {
    status = successCount / Math.max(1, results.length) >= quorumRatio ? "SUCCESS" : "FAIL";
  } else {
    status = failCount === 0 ? "SUCCESS" : "PARTIAL_SUCCESS";
  }

  await emit(callbacks, "ParallelCompleted", node.id, {
    fanInNodeId,
    branchCount: results.length,
    successCount,
    failCount,
    joinPolicy
  });

  return {
    fanInNodeId,
    outcome: {
      status,
      notes: `Parallel completed with ${successCount} success and ${failCount} fail`,
      contextUpdates: {
        "parallel.success_count": successCount,
        "parallel.fail_count": failCount
      }
    }
  };
}

function ensureStateDefaults(state: EngineState): EngineState {
  return {
    context: state.context ?? {},
    nodeOutputs: state.nodeOutputs ?? {},
    parallelOutputs: state.parallelOutputs ?? {},
    nodeOutcomes: state.nodeOutcomes ?? {},
    nodeRetryCounts: state.nodeRetryCounts ?? {},
    completedNodes: state.completedNodes ?? []
  };
}

export async function executeGraph(input: ExecuteGraphInput): Promise<ExecuteGraphResult> {
  const state = ensureStateDefaults(
    input.initialState ?? {
      context: {},
      nodeOutputs: {},
      parallelOutputs: {},
      nodeOutcomes: {},
      nodeRetryCounts: {},
      completedNodes: []
    }
  );

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

    if (isExitNode(node)) {
      const failedGoalGate = findUnsatisfiedGoalGate(input.graph, state);
      if (failedGoalGate) {
        const retryTarget = goalGateRetryTarget(failedGoalGate, input.graph);
        if (!retryTarget) {
          throw new Error(
            `Goal gate unsatisfied at ${failedGoalGate.id} and no retry target is configured`
          );
        }
        await emit(input.callbacks, "GoalGateRedirected", node.id, {
          failedNodeId: failedGoalGate.id,
          retryTarget
        });
        currentNodeId = retryTarget;
        continue;
      }

      state.context.current_node = node.id;
      return {
        state,
        exitNodeId: node.id
      };
    }

    if (node.type === "parallel") {
      const parallel = await executeParallelNode(input.graph, node, state, input.callbacks);
      await saveOutcome(
        input.callbacks,
        node.id,
        parallel.outcome.status,
        serializableOutcome(parallel.outcome),
        1
      );
      applyContextUpdates(state, node, parallel.outcome);

      if (parallel.outcome.status === "FAIL") {
        const failEdge = selectConditionMatchedEdge(input.graph, node.id, state, parallel.outcome);
        if (failEdge) {
          currentNodeId = failEdge.to;
          continue;
        }
        const retryTarget = retryTargetForNode(node, input.graph);
        if (retryTarget) {
          currentNodeId = retryTarget;
          continue;
        }
        throw new Error(parallel.outcome.failureReason ?? `Parallel node ${node.id} failed`);
      }

      if (!parallel.fanInNodeId) {
        throw new Error(`Parallel node ${node.id} did not resolve a fan-in target`);
      }
      currentNodeId = parallel.fanInNodeId;
      continue;
    }

    const outcome = await executeNodeWithRetry(node, input.graph, state, input.callbacks);
    applyContextUpdates(state, node, outcome);

    if (outcome.status === "FAIL") {
      const failEdge = selectConditionMatchedEdge(input.graph, node.id, state, outcome);
      if (failEdge) {
        currentNodeId = failEdge.to;
        continue;
      }
      const retryTarget = retryTargetForNode(node, input.graph);
      if (retryTarget) {
        currentNodeId = retryTarget;
        continue;
      }
      throw new Error(outcome.failureReason ?? `Node ${node.id} failed with no fail route`);
    }

    const nextEdge = selectNextEdge(input.graph, node.id, state, outcome);
    if (!nextEdge) {
      return {
        state,
        exitNodeId: node.id
      };
    }

    if (parseBoolean(nextEdge.attrs.loop_restart, false)) {
      throw new Error("loop_restart is not implemented in this runtime");
    }

    currentNodeId = nextEdge.to;
  }

  throw new Error(`Graph execution exceeded max steps (${maxSteps})`);
}
