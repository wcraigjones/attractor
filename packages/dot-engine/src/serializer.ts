import type { DotGraph } from "./types.js";

function quote(value: string): string {
  return JSON.stringify(value);
}

function sortedEntries(attrs: Record<string, string>): Array<[string, string]> {
  return Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
}

function formatAttrBlock(attrs: Record<string, string>): string {
  const entries = sortedEntries(attrs);
  if (entries.length === 0) {
    return "";
  }
  const body = entries.map(([key, value]) => `${key}=${quote(value)}`).join(", ");
  return ` [${body}]`;
}

function serializeNode(graph: DotGraph, nodeId: string): string {
  const node = graph.nodes[nodeId];
  if (!node) {
    return "";
  }
  return `  ${node.id}${formatAttrBlock(node.attrs)};`;
}

function serializeEdge(
  edge: { from: string; to: string; attrs: Record<string, string> }
): string {
  return `  ${edge.from} -> ${edge.to}${formatAttrBlock(edge.attrs)};`;
}

export function serializeDotGraphCanonical(graph: DotGraph): string {
  const lines: string[] = [];
  lines.push(`digraph ${graph.name} {`);

  if (Object.keys(graph.graphAttrs).length > 0) {
    lines.push(`  graph${formatAttrBlock(graph.graphAttrs)};`);
  }
  if (Object.keys(graph.nodeDefaults).length > 0) {
    lines.push(`  node${formatAttrBlock(graph.nodeDefaults)};`);
  }
  if (Object.keys(graph.edgeDefaults).length > 0) {
    lines.push(`  edge${formatAttrBlock(graph.edgeDefaults)};`);
  }

  const sortedNodeIds = [...graph.nodeOrder].sort((a, b) => a.localeCompare(b));
  for (const nodeId of sortedNodeIds) {
    const serialized = serializeNode(graph, nodeId);
    if (serialized.length > 0) {
      lines.push(serialized);
    }
  }

  const sortedEdges = [...graph.edges].sort((a, b) => {
    if (a.from !== b.from) {
      return a.from.localeCompare(b.from);
    }
    if (a.to !== b.to) {
      return a.to.localeCompare(b.to);
    }
    const aSig = JSON.stringify(sortedEntries(a.attrs));
    const bSig = JSON.stringify(sortedEntries(b.attrs));
    return aSig.localeCompare(bSig);
  });

  for (const edge of sortedEdges) {
    lines.push(serializeEdge(edge));
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}
