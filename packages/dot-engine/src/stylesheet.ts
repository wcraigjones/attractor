import type { DotGraph, DotNode } from "./types.js";

export type StylesheetSelectorType = "universal" | "shape" | "class" | "id";

export interface StylesheetRule {
  selector: string;
  selectorType: StylesheetSelectorType;
  selectorValue: string;
  specificity: number;
  order: number;
  props: Record<string, string>;
}

function decodeValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function selectorInfo(selector: string): {
  selectorType: StylesheetSelectorType;
  selectorValue: string;
  specificity: number;
} {
  const trimmed = selector.trim();
  if (trimmed === "*") {
    return { selectorType: "universal", selectorValue: "*", specificity: 0 };
  }
  if (trimmed.startsWith("#")) {
    return { selectorType: "id", selectorValue: trimmed.slice(1), specificity: 3 };
  }
  if (trimmed.startsWith(".")) {
    return { selectorType: "class", selectorValue: trimmed.slice(1), specificity: 2 };
  }
  return { selectorType: "shape", selectorValue: trimmed, specificity: 1 };
}

function parseProps(raw: string): Record<string, string> {
  const props: Record<string, string> = {};
  const declarations = raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const declaration of declarations) {
    const colon = declaration.indexOf(":");
    if (colon <= 0) {
      throw new Error(`Invalid stylesheet declaration: ${declaration}`);
    }
    const key = declaration.slice(0, colon).trim();
    const value = decodeValue(declaration.slice(colon + 1));
    if (!key || !value) {
      throw new Error(`Invalid stylesheet declaration: ${declaration}`);
    }
    props[key] = value;
  }

  return props;
}

export function parseModelStylesheet(source: string): StylesheetRule[] {
  const input = source.trim();
  if (!input) {
    return [];
  }

  const rules: StylesheetRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = pattern.exec(input))) {
    const selector = (match[1] ?? "").trim();
    const body = (match[2] ?? "").trim();
    if (!selector) {
      continue;
    }
    if (!body) {
      throw new Error(`Stylesheet selector ${selector} has no declarations`);
    }

    const parsedSelector = selectorInfo(selector);
    const props = parseProps(body);
    rules.push({
      selector,
      selectorType: parsedSelector.selectorType,
      selectorValue: parsedSelector.selectorValue,
      specificity: parsedSelector.specificity,
      order,
      props
    });
    order += 1;
  }

  if (rules.length === 0 && input.length > 0) {
    throw new Error("No stylesheet rules parsed");
  }

  return rules;
}

function nodeClasses(node: DotNode): Set<string> {
  const classes = (node.attrs.class ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set(classes);
}

function matchesSelector(node: DotNode, rule: StylesheetRule): boolean {
  if (rule.selectorType === "universal") {
    return true;
  }
  if (rule.selectorType === "shape") {
    return node.shape === rule.selectorValue;
  }
  if (rule.selectorType === "id") {
    return node.id === rule.selectorValue;
  }
  return nodeClasses(node).has(rule.selectorValue);
}

const STYLE_PROPS = ["llm_model", "llm_provider", "reasoning_effort"] as const;

export function applyModelStylesheet(graph: DotGraph, rules: StylesheetRule[]): DotGraph {
  if (rules.length === 0) {
    return graph;
  }

  const nextNodes = { ...graph.nodes };
  const sortedRules = [...rules].sort((a, b) => {
    if (a.specificity !== b.specificity) {
      return a.specificity - b.specificity;
    }
    return a.order - b.order;
  });

  for (const nodeId of graph.nodeOrder) {
    const original = graph.nodes[nodeId];
    if (!original) {
      continue;
    }
    const attrs = { ...original.attrs };

    for (const prop of STYLE_PROPS) {
      if (attrs[prop] !== undefined) {
        continue;
      }
      let resolved: string | undefined;
      for (const rule of sortedRules) {
        if (!matchesSelector(original, rule)) {
          continue;
        }
        if (rule.props[prop] !== undefined) {
          resolved = rule.props[prop];
        }
      }
      if (resolved !== undefined) {
        attrs[prop] = resolved;
      }
    }

    nextNodes[nodeId] = {
      ...original,
      attrs
    };
  }

  return {
    ...graph,
    nodes: nextNodes
  };
}
