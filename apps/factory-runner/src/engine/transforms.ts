import { applyModelStylesheet, parseModelStylesheet } from "./stylesheet.js";
import type { DotGraph } from "./types.js";

export function applyVariableExpansion(graph: DotGraph): DotGraph {
  const goal = graph.graphAttrs.goal ?? "";
  if (!goal) {
    return graph;
  }

  const nextNodes = { ...graph.nodes };
  for (const nodeId of graph.nodeOrder) {
    const node = graph.nodes[nodeId];
    if (!node) {
      continue;
    }
    if (!node.prompt.includes("$goal")) {
      continue;
    }
    const prompt = node.prompt.replace(/\$goal/g, goal);
    nextNodes[nodeId] = {
      ...node,
      prompt,
      attrs: {
        ...node.attrs,
        prompt
      }
    };
  }

  return {
    ...graph,
    nodes: nextNodes
  };
}

export function applyGraphTransforms(graph: DotGraph): DotGraph {
  const expanded = applyVariableExpansion(graph);
  const stylesheet = expanded.graphAttrs.model_stylesheet ?? "";
  if (!stylesheet.trim()) {
    return expanded;
  }

  const rules = parseModelStylesheet(stylesheet);
  return applyModelStylesheet(expanded, rules);
}
