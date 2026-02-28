import type { EnvironmentShellServerMessage } from "./types";

export function parseEnvironmentShellServerMessage(raw: string): EnvironmentShellServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (value.type === "status" && typeof value.state === "string") {
    const state = value.state;
    if (state === "starting pod" || state === "connecting" || state === "ready" || state === "disconnected" || state === "error") {
      return { type: "status", state };
    }
    return null;
  }
  if (
    value.type === "output" &&
    (value.stream === "stdout" || value.stream === "stderr") &&
    typeof value.data === "string"
  ) {
    return {
      type: "output",
      stream: value.stream,
      data: value.data
    };
  }
  if (value.type === "exit") {
    return { type: "exit", status: value.status };
  }
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message };
  }
  return null;
}
