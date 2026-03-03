import { describe, expect, it } from "vitest";

import { parseEnvironmentShellServerMessage } from "../apps/factory-web/src/client/lib/environment-shell";

describe("environment shell protocol parsing", () => {
  it("parses status messages", () => {
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "status", state: "ready" }))).toEqual({
      type: "status",
      state: "ready"
    });
  });

  it("parses output and error messages", () => {
    expect(
      parseEnvironmentShellServerMessage(
        JSON.stringify({ type: "output", stream: "stdout", data: "hello" })
      )
    ).toEqual({
      type: "output",
      stream: "stdout",
      data: "hello"
    });
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "error", message: "boom" }))).toEqual({
      type: "error",
      message: "boom"
    });
  });

  it("parses exit messages", () => {
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "exit", status: 0 }))).toEqual({
      type: "exit",
      status: 0
    });
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "exit", status: 137 }))).toEqual({
      type: "exit",
      status: 137
    });
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "exit" }))).toEqual({
      type: "exit",
      status: undefined
    });
  });

  it("parses all valid status states", () => {
    for (const state of ["starting pod", "connecting", "ready", "disconnected", "error"]) {
      expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "status", state }))).toEqual({
        type: "status",
        state
      });
    }
  });

  it("parses stderr output messages", () => {
    expect(
      parseEnvironmentShellServerMessage(JSON.stringify({ type: "output", stream: "stderr", data: "warning" }))
    ).toEqual({ type: "output", stream: "stderr", data: "warning" });
  });

  it("rejects invalid payloads", () => {
    expect(parseEnvironmentShellServerMessage("not-json")).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "status", state: "bogus" }))).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify({}))).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "output", stream: "stdout" }))).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "error", message: 42 }))).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify(null))).toBeNull();
  });
});
