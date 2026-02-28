import type { DotEdge, DotGraph, DotNode, HandlerType } from "./types.js";

const nodeIdPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
      }
    }

    const isTerminator = !quote && bracketDepth === 0 && (ch === ";" || ch === "\n");
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

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
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
  const open = trimmed.lastIndexOf("[");
  const close = trimmed.endsWith("]") ? trimmed.length - 1 : -1;
  if (open === -1 || close === -1 || close < open) {
    return { body: trimmed, attrs: {} };
  }

  const prefix = trimmed.slice(0, open).trim();
  const block = trimmed.slice(open, close + 1);
  return { body: prefix, attrs: parseAttrBlock(block) };
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

export function parseDotGraph(source: string): DotGraph {
  const clean = stripComments(source).trim();
  const match = clean.match(/^digraph\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*)\}\s*$/);
  if (!match) {
    throw new Error("Expected a single digraph definition");
  }

  const graphName = match[1] ?? "Graph";
  const body = match[2] ?? "";
  const statements = splitStatements(body);

  const graphAttrs: Record<string, string> = {};
  const nodeDefaults: Record<string, string> = {};
  const edgeDefaults: Record<string, string> = {};
  const nodes: Record<string, DotNode> = {};
  const nodeOrder: string[] = [];
  const edges: DotEdge[] = [];

  for (const statement of statements) {
    if (!statement) {
      continue;
    }

    if (statement.startsWith("graph ")) {
      Object.assign(graphAttrs, parseAttrBlock(statement.slice("graph".length).trim()));
      continue;
    }

    if (statement.startsWith("node ")) {
      Object.assign(nodeDefaults, parseAttrBlock(statement.slice("node".length).trim()));
      continue;
    }

    if (statement.startsWith("edge ")) {
      Object.assign(edgeDefaults, parseAttrBlock(statement.slice("edge".length).trim()));
      continue;
    }

    const graphDecl = statement.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/);
    if (graphDecl) {
      graphAttrs[graphDecl[1] ?? ""] = decodeValue(graphDecl[2] ?? "");
      continue;
    }

    if (statement.includes("->")) {
      const extracted = extractAttrBlock(statement);
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
        const attrs = { ...edgeDefaults, ...extracted.attrs };
        edges.push({
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

    const extracted = extractAttrBlock(statement);
    const nodeId = extracted.body.trim();
    if (!nodeIdPattern.test(nodeId)) {
      throw new Error(`Invalid node statement: ${statement}`);
    }

    const attrs = { ...nodeDefaults, ...extracted.attrs };
    const nextNode: DotNode = {
      id: nodeId,
      attrs,
      label: attrs.label ?? nodeId,
      prompt: attrs.prompt ?? "",
      shape: attrs.shape ?? "box",
      type: handlerTypeFor(attrs)
    };
    if (!nodes[nodeId]) {
      nodeOrder.push(nodeId);
    }
    nodes[nodeId] = nextNode;
  }

  return {
    name: graphName,
    graphAttrs,
    nodeDefaults,
    edgeDefaults,
    nodes,
    nodeOrder,
    edges
  };
}

export function validateDotGraph(graph: DotGraph): void {
  const starts = graph.nodeOrder.filter((id) => graph.nodes[id]?.type === "start");
  const exits = graph.nodeOrder.filter((id) => graph.nodes[id]?.type === "exit");

  if (starts.length !== 1) {
    throw new Error(`Graph must have exactly one start node, found ${starts.length}`);
  }
  if (exits.length < 1) {
    throw new Error("Graph must have at least one exit node");
  }

  for (const edge of graph.edges) {
    if (!graph.nodes[edge.from]) {
      throw new Error(`Edge source node not found: ${edge.from}`);
    }
    if (!graph.nodes[edge.to]) {
      throw new Error(`Edge target node not found: ${edge.to}`);
    }
  }
}
