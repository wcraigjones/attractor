import { parseModelStylesheet } from "./stylesheet.js";
import { validateConditionSyntax } from "./condition.js";
import type { DotDiagnostic, DotEdge, DotGraph, DotNode, HandlerType } from "./types.js";

const nodeIdPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const knownHandlerTypes = new Set<HandlerType>([
  "start",
  "exit",
  "codergen",
  "wait.human",
  "conditional",
  "parallel",
  "parallel.fan_in",
  "tool",
  "stack.manager_loop",
  "custom"
]);
const validFidelityValues = new Set([
  "full",
  "truncate",
  "compact",
  "summary:low",
  "summary:medium",
  "summary:high"
]);

interface ParseScope {
  nodeDefaults: Record<string, string>;
  edgeDefaults: Record<string, string>;
  classes: string[];
}

interface ParseAccumulator {
  graphAttrs: Record<string, string>;
  nodeDefaults: Record<string, string>;
  edgeDefaults: Record<string, string>;
  nodes: Record<string, DotNode>;
  nodeOrder: string[];
  edges: DotEdge[];
}

function stripComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function splitStatements(body: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index] ?? "";
    const prev = index > 0 ? body[index - 1] : "";

    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }
    }

    if (!quote) {
      if (ch === "[") {
        bracketDepth += 1;
      } else if (ch === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (ch === "{") {
        braceDepth += 1;
      } else if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    const isTerminator =
      !quote && bracketDepth === 0 && braceDepth === 0 && (ch === ";" || ch === "\n");
    if (isTerminator) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function decodeValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }

  return trimmed;
}

function parseAttrBlock(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  const text = raw.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    throw new Error(`Invalid attribute block: ${raw}`);
  }

  const content = text.slice(1, -1);
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index] ?? "";
    const prev = index > 0 ? content[index - 1] : "";

    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }
    }

    if (ch === "," && !quote) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    parts.push(tail);
  }

  const attrs: Record<string, string> = {};
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1);
    attrs[key] = decodeValue(value);
  }
  return attrs;
}

function extractAttrBlock(statement: string): { body: string; attrs: Record<string, string> } {
  const trimmed = statement.trim();
  if (!trimmed.endsWith("]")) {
    return { body: trimmed, attrs: {} };
  }

  let quote: '"' | "'" | null = null;
  let depth = 0;
  let open = -1;

  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const ch = trimmed[index] ?? "";
    const prev = index > 0 ? trimmed[index - 1] : "";

    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }
      continue;
    }

    if (quote) {
      continue;
    }

    if (ch === "]") {
      depth += 1;
      continue;
    }
    if (ch === "[") {
      depth -= 1;
      if (depth === 0) {
        open = index;
        break;
      }
    }
  }

  if (open < 0) {
    return { body: trimmed, attrs: {} };
  }

  const prefix = trimmed.slice(0, open).trim();
  const block = trimmed.slice(open);
  return { body: prefix, attrs: parseAttrBlock(block) };
}

function sanitizeClassName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function mergeClasses(explicit: string | undefined, inherited: string[]): string | undefined {
  const explicitClasses = (explicit ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const merged = [...new Set([...explicitClasses, ...inherited])];
  return merged.length > 0 ? merged.join(",") : undefined;
}

function isTruthy(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const lowered = raw.trim().toLowerCase();
  return lowered === "true" || lowered === "1" || lowered === "yes";
}

function handlerTypeFor(nodeAttrs: Record<string, string>): HandlerType {
  const explicit = nodeAttrs.type;
  if (explicit) {
    if (
      explicit === "start" ||
      explicit === "exit" ||
      explicit === "codergen" ||
      explicit === "wait.human" ||
      explicit === "conditional" ||
      explicit === "parallel" ||
      explicit === "parallel.fan_in" ||
      explicit === "tool" ||
      explicit === "stack.manager_loop"
    ) {
      return explicit;
    }
    return "custom";
  }

  const shape = nodeAttrs.shape ?? "box";
  if (shape === "Mdiamond") return "start";
  if (shape === "Msquare") return "exit";
  if (shape === "box") return "codergen";
  if (shape === "hexagon") return "wait.human";
  if (shape === "diamond") return "conditional";
  if (shape === "component") return "parallel";
  if (shape === "tripleoctagon") return "parallel.fan_in";
  if (shape === "parallelogram") return "tool";
  if (shape === "house") return "stack.manager_loop";
  return "custom";
}

function applyNode(acc: ParseAccumulator, nodeId: string, attrs: Record<string, string>): void {
  const nextNode: DotNode = {
    id: nodeId,
    attrs,
    label: attrs.label ?? nodeId,
    prompt: attrs.prompt ?? "",
    shape: attrs.shape ?? "box",
    type: handlerTypeFor(attrs)
  };
  if (!acc.nodes[nodeId]) {
    acc.nodeOrder.push(nodeId);
  }
  acc.nodes[nodeId] = nextNode;
}

function parseSubgraphLabel(body: string): string | undefined {
  const statements = splitStatements(body);
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("graph ")) {
      const attrs = parseAttrBlock(trimmed.slice("graph".length).trim());
      if (attrs.label) {
        return attrs.label;
      }
      continue;
    }
    const match = trimmed.match(/^label\s*=\s*(.+)$/);
    if (match) {
      return decodeValue(match[1] ?? "");
    }
  }
  return undefined;
}

function parseSubgraphStatement(
  statement: string,
  scope: ParseScope,
  acc: ParseAccumulator
): void {
  const open = statement.indexOf("{");
  const close = statement.lastIndexOf("}");
  if (open < 0 || close <= open) {
    throw new Error(`Invalid subgraph statement: ${statement}`);
  }

  const innerBody = statement.slice(open + 1, close);
  const subgraphLabel = parseSubgraphLabel(innerBody);
  const derivedClass = subgraphLabel ? sanitizeClassName(subgraphLabel) : "";
  const classes = derivedClass
    ? [...scope.classes, derivedClass]
    : [...scope.classes];

  parseBlock(
    innerBody,
    {
      nodeDefaults: { ...scope.nodeDefaults },
      edgeDefaults: { ...scope.edgeDefaults },
      classes
    },
    acc,
    false
  );
}

function parseBlock(
  body: string,
  scope: ParseScope,
  acc: ParseAccumulator,
  isTopLevel: boolean
): void {
  const statements = splitStatements(body);
  const localNodeDefaults = { ...scope.nodeDefaults };
  const localEdgeDefaults = { ...scope.edgeDefaults };

  for (const statement of statements) {
    const trimmed = statement.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("subgraph")) {
      parseSubgraphStatement(trimmed, {
        nodeDefaults: localNodeDefaults,
        edgeDefaults: localEdgeDefaults,
        classes: scope.classes
      }, acc);
      continue;
    }

    if (trimmed.startsWith("graph ")) {
      const attrs = parseAttrBlock(trimmed.slice("graph".length).trim());
      if (isTopLevel) {
        Object.assign(acc.graphAttrs, attrs);
      }
      continue;
    }

    if (trimmed.startsWith("node ")) {
      const attrs = parseAttrBlock(trimmed.slice("node".length).trim());
      Object.assign(localNodeDefaults, attrs);
      if (isTopLevel) {
        Object.assign(acc.nodeDefaults, attrs);
      }
      continue;
    }

    if (trimmed.startsWith("edge ")) {
      const attrs = parseAttrBlock(trimmed.slice("edge".length).trim());
      Object.assign(localEdgeDefaults, attrs);
      if (isTopLevel) {
        Object.assign(acc.edgeDefaults, attrs);
      }
      continue;
    }

    const graphDecl = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/);
    if (graphDecl) {
      if (isTopLevel) {
        acc.graphAttrs[graphDecl[1] ?? ""] = decodeValue(graphDecl[2] ?? "");
      }
      continue;
    }

    if (trimmed.includes("->")) {
      const extracted = extractAttrBlock(trimmed);
      const chain = extracted.body.split("->").map((item) => item.trim()).filter(Boolean);
      if (chain.length < 2) {
        throw new Error(`Invalid edge statement: ${statement}`);
      }

      for (let index = 0; index < chain.length - 1; index += 1) {
        const from = chain[index] ?? "";
        const to = chain[index + 1] ?? "";
        if (!nodeIdPattern.test(from) || !nodeIdPattern.test(to)) {
          throw new Error(`Invalid edge node ID in statement: ${statement}`);
        }
        const attrs = { ...localEdgeDefaults, ...extracted.attrs };
        acc.edges.push({
          from,
          to,
          attrs,
          label: attrs.label ?? "",
          condition: attrs.condition ?? "",
          weight: Number.parseInt(attrs.weight ?? "0", 10) || 0
        });
      }
      continue;
    }

    const extracted = extractAttrBlock(trimmed);
    const nodeId = extracted.body.trim();
    if (!nodeIdPattern.test(nodeId)) {
      throw new Error(`Invalid node statement: ${statement}`);
    }

    const attrs = { ...localNodeDefaults, ...extracted.attrs };
    const classValue = mergeClasses(attrs.class, scope.classes);
    if (classValue) {
      attrs.class = classValue;
    }
    applyNode(acc, nodeId, attrs);
  }
}

function isStartNode(node: DotNode): boolean {
  return node.type === "start" || node.id.toLowerCase() === "start";
}

function isExitNode(node: DotNode): boolean {
  const lowered = node.id.toLowerCase();
  return node.type === "exit" || lowered === "exit" || lowered === "end";
}

function startNodeIds(graph: DotGraph): string[] {
  return graph.nodeOrder.filter((id) => {
    const node = graph.nodes[id];
    return node ? isStartNode(node) : false;
  });
}

function exitNodeIds(graph: DotGraph): string[] {
  return graph.nodeOrder.filter((id) => {
    const node = graph.nodes[id];
    return node ? isExitNode(node) : false;
  });
}

function ensureConditionDiagnostics(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  for (const edge of graph.edges) {
    if (!edge.condition.trim()) {
      continue;
    }
    try {
      validateConditionSyntax(edge.condition);
    } catch (error) {
      diagnostics.push({
        rule: "condition_syntax",
        severity: "ERROR",
        message: `Invalid condition on edge ${edge.from} -> ${edge.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        edge: { from: edge.from, to: edge.to }
      });
    }
  }
}

function ensureStylesheetDiagnostics(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  const stylesheet = graph.graphAttrs.model_stylesheet ?? "";
  if (!stylesheet.trim()) {
    return;
  }
  try {
    parseModelStylesheet(stylesheet);
  } catch (error) {
    diagnostics.push({
      rule: "stylesheet_syntax",
      severity: "ERROR",
      message: `model_stylesheet parse failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    });
  }
}

function lintReachability(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  const starts = startNodeIds(graph);
  if (starts.length === 0) {
    return;
  }

  const visited = new Set<string>();
  const queue = [starts[0] ?? ""];
  while (queue.length > 0) {
    const nodeId = queue.shift() ?? "";
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    for (const edge of graph.edges) {
      if (edge.from === nodeId && !visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  for (const nodeId of graph.nodeOrder) {
    if (!visited.has(nodeId)) {
      diagnostics.push({
        rule: "reachability",
        severity: "ERROR",
        message: `Node ${nodeId} is unreachable from start`,
        nodeId
      });
    }
  }
}

function lintTypeKnown(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  for (const nodeId of graph.nodeOrder) {
    const node = graph.nodes[nodeId];
    if (!node || !node.attrs.type) {
      continue;
    }
    if (!knownHandlerTypes.has(node.attrs.type as HandlerType)) {
      diagnostics.push({
        rule: "type_known",
        severity: "WARNING",
        message: `Node ${node.id} uses unknown type ${node.attrs.type}`,
        nodeId: node.id
      });
    }
  }
}

function lintFidelity(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  const graphFidelity = graph.graphAttrs.default_fidelity;
  if (graphFidelity && !validFidelityValues.has(graphFidelity)) {
    diagnostics.push({
      rule: "fidelity_valid",
      severity: "WARNING",
      message: `Graph default_fidelity has invalid value: ${graphFidelity}`
    });
  }
  for (const nodeId of graph.nodeOrder) {
    const node = graph.nodes[nodeId];
    if (node?.attrs.fidelity && !validFidelityValues.has(node.attrs.fidelity)) {
      diagnostics.push({
        rule: "fidelity_valid",
        severity: "WARNING",
        message: `Node ${node.id} has invalid fidelity: ${node.attrs.fidelity}`,
        nodeId: node.id
      });
    }
  }
  for (const edge of graph.edges) {
    if (edge.attrs.fidelity && !validFidelityValues.has(edge.attrs.fidelity)) {
      diagnostics.push({
        rule: "fidelity_valid",
        severity: "WARNING",
        message: `Edge ${edge.from} -> ${edge.to} has invalid fidelity: ${edge.attrs.fidelity}`,
        edge: { from: edge.from, to: edge.to }
      });
    }
  }
}

function lintRetryTargets(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  const hasNode = (nodeId: string) => Boolean(graph.nodes[nodeId]);

  const graphRetry = graph.graphAttrs.retry_target;
  if (graphRetry && !hasNode(graphRetry)) {
    diagnostics.push({
      rule: "retry_target_exists",
      severity: "WARNING",
      message: `Graph retry_target does not exist: ${graphRetry}`
    });
  }
  const graphFallbackRetry = graph.graphAttrs.fallback_retry_target;
  if (graphFallbackRetry && !hasNode(graphFallbackRetry)) {
    diagnostics.push({
      rule: "retry_target_exists",
      severity: "WARNING",
      message: `Graph fallback_retry_target does not exist: ${graphFallbackRetry}`
    });
  }

  for (const nodeId of graph.nodeOrder) {
    const node = graph.nodes[nodeId];
    if (!node) {
      continue;
    }
    const retryTarget = node.attrs.retry_target;
    if (retryTarget && !hasNode(retryTarget)) {
      diagnostics.push({
        rule: "retry_target_exists",
        severity: "WARNING",
        message: `Node ${node.id} retry_target does not exist: ${retryTarget}`,
        nodeId: node.id
      });
    }
    const fallbackRetryTarget = node.attrs.fallback_retry_target;
    if (fallbackRetryTarget && !hasNode(fallbackRetryTarget)) {
      diagnostics.push({
        rule: "retry_target_exists",
        severity: "WARNING",
        message: `Node ${node.id} fallback_retry_target does not exist: ${fallbackRetryTarget}`,
        nodeId: node.id
      });
    }
  }
}

function lintGoalGates(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  const graphRetryConfigured = Boolean(
    graph.graphAttrs.retry_target || graph.graphAttrs.fallback_retry_target
  );

  for (const nodeId of graph.nodeOrder) {
    const node = graph.nodes[nodeId];
    if (!node || !isTruthy(node.attrs.goal_gate)) {
      continue;
    }
    const hasNodeRetry = Boolean(node.attrs.retry_target || node.attrs.fallback_retry_target);
    if (!hasNodeRetry && !graphRetryConfigured) {
      diagnostics.push({
        rule: "goal_gate_has_retry",
        severity: "WARNING",
        message: `goal_gate node ${node.id} has no retry target at node or graph level`,
        nodeId: node.id
      });
    }
  }
}

function lintPromptOnLlmNodes(graph: DotGraph, diagnostics: DotDiagnostic[]): void {
  for (const nodeId of graph.nodeOrder) {
    const node = graph.nodes[nodeId];
    if (!node || node.type !== "codergen") {
      continue;
    }
    const hasPrompt = Boolean(node.prompt.trim().length > 0);
    const hasLabelAttr = Boolean(node.attrs.label && node.attrs.label.trim().length > 0);
    if (!hasPrompt && !hasLabelAttr) {
      diagnostics.push({
        rule: "prompt_on_llm_nodes",
        severity: "WARNING",
        message: `Codergen node ${node.id} should provide prompt or label`,
        nodeId: node.id
      });
    }
  }
}

export function parseDotGraph(source: string): DotGraph {
  const clean = stripComments(source).trim();
  const match = clean.match(/^digraph\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*)\}\s*$/);
  if (!match) {
    throw new Error("Expected a single digraph definition");
  }

  const graphName = match[1] ?? "Graph";
  const body = match[2] ?? "";

  const acc: ParseAccumulator = {
    graphAttrs: {},
    nodeDefaults: {},
    edgeDefaults: {},
    nodes: {},
    nodeOrder: [],
    edges: []
  };

  parseBlock(
    body,
    {
      nodeDefaults: {},
      edgeDefaults: {},
      classes: []
    },
    acc,
    true
  );

  return {
    name: graphName,
    graphAttrs: acc.graphAttrs,
    nodeDefaults: acc.nodeDefaults,
    edgeDefaults: acc.edgeDefaults,
    nodes: acc.nodes,
    nodeOrder: acc.nodeOrder,
    edges: acc.edges
  };
}

export function lintDotGraph(graph: DotGraph): DotDiagnostic[] {
  const diagnostics: DotDiagnostic[] = [];
  const starts = startNodeIds(graph);
  const exits = exitNodeIds(graph);

  if (starts.length !== 1) {
    diagnostics.push({
      rule: "start_node",
      severity: "ERROR",
      message: `Graph must contain exactly one start node; found ${starts.length}`
    });
  }

  if (exits.length !== 1) {
    diagnostics.push({
      rule: "terminal_node",
      severity: "ERROR",
      message: `Graph must contain exactly one terminal node; found ${exits.length}`
    });
  }

  const startId = starts[0];
  if (startId) {
    const incoming = graph.edges.filter((edge) => edge.to === startId);
    if (incoming.length > 0) {
      diagnostics.push({
        rule: "start_no_incoming",
        severity: "ERROR",
        message: `Start node ${startId} must not have incoming edges`,
        nodeId: startId
      });
    }
  }

  for (const exitId of exits) {
    const outgoing = graph.edges.filter((edge) => edge.from === exitId);
    if (outgoing.length > 0) {
      diagnostics.push({
        rule: "exit_no_outgoing",
        severity: "ERROR",
        message: `Exit node ${exitId} must not have outgoing edges`,
        nodeId: exitId
      });
    }
  }

  for (const edge of graph.edges) {
    if (!graph.nodes[edge.from]) {
      diagnostics.push({
        rule: "edge_target_exists",
        severity: "ERROR",
        message: `Edge source ${edge.from} does not exist`,
        edge: { from: edge.from, to: edge.to }
      });
    }
    if (!graph.nodes[edge.to]) {
      diagnostics.push({
        rule: "edge_target_exists",
        severity: "ERROR",
        message: `Edge target ${edge.to} does not exist`,
        edge: { from: edge.from, to: edge.to }
      });
    }
  }

  lintReachability(graph, diagnostics);
  ensureConditionDiagnostics(graph, diagnostics);
  ensureStylesheetDiagnostics(graph, diagnostics);
  lintTypeKnown(graph, diagnostics);
  lintFidelity(graph, diagnostics);
  lintRetryTargets(graph, diagnostics);
  lintGoalGates(graph, diagnostics);
  lintPromptOnLlmNodes(graph, diagnostics);

  return diagnostics;
}

export function validateDotGraph(graph: DotGraph): void {
  const diagnostics = lintDotGraph(graph);
  const errors = diagnostics.filter((item) => item.severity === "ERROR");
  if (errors.length === 0) {
    return;
  }

  const message = errors
    .map((item) => `${item.rule}: ${item.message}`)
    .join("; ");
  throw new Error(message);
}
