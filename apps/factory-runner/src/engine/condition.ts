import type { EngineState } from "./types.js";

function splitTopLevel(expression: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < expression.length; index += 1) {
    const ch = expression[index] ?? "";
    const prev = index > 0 ? expression[index - 1] : "";

    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }
    }

    if (!quote && expression.startsWith(separator, index)) {
      parts.push(current.trim());
      current = "";
      index += separator.length - 1;
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function resolvePath(path: string, state: EngineState): unknown {
  const normalized = path.trim();
  if (!normalized) {
    return undefined;
  }

  const root = {
    context: state.context,
    nodeOutputs: state.nodeOutputs,
    parallelOutputs: state.parallelOutputs
  } as Record<string, unknown>;

  const parts = normalized.split(".").filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseValue(raw: string, state: EngineState): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number.parseFloat(value);
  }
  return resolvePath(value, state);
}

function evaluateBinary(expression: string, state: EngineState): boolean {
  const comparator = expression.match(/^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*?)$/);
  if (!comparator) {
    return Boolean(parseValue(expression, state));
  }

  const left = parseValue(comparator[1] ?? "", state);
  const right = parseValue(comparator[3] ?? "", state);
  const op = comparator[2] ?? "==";

  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  if (op === ">") return Number(left) > Number(right);
  if (op === "<") return Number(left) < Number(right);
  if (op === ">=") return Number(left) >= Number(right);
  if (op === "<=") return Number(left) <= Number(right);
  return false;
}

export function evaluateCondition(expression: string, state: EngineState): boolean {
  const expr = expression.trim();
  if (!expr) {
    return true;
  }

  const orParts = splitTopLevel(expr, "||");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateCondition(part, state));
  }

  const andParts = splitTopLevel(expr, "&&");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateCondition(part, state));
  }

  if (expr.startsWith("!")) {
    return !evaluateCondition(expr.slice(1), state);
  }

  return evaluateBinary(expr, state);
}
