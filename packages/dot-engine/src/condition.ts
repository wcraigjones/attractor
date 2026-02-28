import type { EngineState, NodeOutcome } from "./types.js";

function splitClauses(expression: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < expression.length; index += 1) {
    const ch = expression[index] ?? "";
    const prev = index > 0 ? expression[index - 1] : "";
    const next = index + 1 < expression.length ? expression[index + 1] ?? "" : "";

    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }
    }

    if (!quote && ch === "&" && next === "&") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
      current = "";
      index += 1;
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    parts.push(tail);
  }
  return parts;
}

function trimLiteral(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function contextLookup(state: EngineState, key: string): unknown {
  if (Object.hasOwn(state.context, key)) {
    return state.context[key];
  }
  if (Object.hasOwn(state.nodeOutputs, key)) {
    return state.nodeOutputs[key];
  }
  return undefined;
}

function resolveKey(key: string, state: EngineState, outcome?: NodeOutcome): string {
  const trimmed = key.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "outcome") {
    return (outcome?.status ?? "").toLowerCase();
  }
  if (trimmed === "preferred_label") {
    return outcome?.preferredLabel ?? "";
  }

  if (trimmed.startsWith("context.")) {
    const direct = contextLookup(state, trimmed);
    if (direct !== undefined) {
      return String(direct);
    }
    const withoutPrefix = trimmed.slice("context.".length);
    const fallback = contextLookup(state, withoutPrefix);
    return fallback !== undefined ? String(fallback) : "";
  }

  const value = contextLookup(state, trimmed);
  return value !== undefined ? String(value) : "";
}

function evaluateClause(clause: string, state: EngineState, outcome?: NodeOutcome): boolean {
  const notEqualIndex = clause.indexOf("!=");
  if (notEqualIndex >= 0) {
    const key = clause.slice(0, notEqualIndex).trim();
    const literal = trimLiteral(clause.slice(notEqualIndex + 2));
    if (!key) {
      throw new Error(`Invalid condition clause: ${clause}`);
    }
    return resolveKey(key, state, outcome) !== literal;
  }

  const equalIndex = clause.indexOf("=");
  if (equalIndex >= 0) {
    const key = clause.slice(0, equalIndex).trim();
    const literal = trimLiteral(clause.slice(equalIndex + 1));
    if (!key) {
      throw new Error(`Invalid condition clause: ${clause}`);
    }
    return resolveKey(key, state, outcome) === literal;
  }

  const resolved = resolveKey(clause.trim(), state, outcome);
  return resolved.length > 0;
}

export function validateConditionSyntax(expression: string): void {
  const trimmed = expression.trim();
  if (!trimmed) {
    return;
  }
  const clauses = splitClauses(trimmed);
  if (clauses.length === 0) {
    throw new Error("Condition is empty");
  }
  for (const clause of clauses) {
    const normalized = clause.trim();
    if (!normalized) {
      throw new Error("Condition contains an empty clause");
    }
    const hasEqual = normalized.includes("=");
    const hasNotEqual = normalized.includes("!=");
    if (hasEqual && !hasNotEqual && normalized.split("=").length !== 2) {
      throw new Error(`Invalid '=' clause: ${normalized}`);
    }
    if (hasNotEqual && normalized.split("!=").length !== 2) {
      throw new Error(`Invalid '!=' clause: ${normalized}`);
    }
  }
}

export function evaluateCondition(
  expression: string,
  state: EngineState,
  outcome?: NodeOutcome
): boolean {
  const trimmed = expression.trim();
  if (!trimmed) {
    return true;
  }

  validateConditionSyntax(trimmed);
  const clauses = splitClauses(trimmed);
  for (const clause of clauses) {
    if (!evaluateClause(clause, state, outcome)) {
      return false;
    }
  }
  return true;
}
