import { describe, expect, it, vi } from "vitest";

import type { DotNode } from "../apps/factory-runner/src/engine/index.js";
import { executeToolNode } from "../apps/factory-runner/src/tool-node.js";

function node(attrs: Record<string, string>): DotNode {
  return {
    id: "toolNode",
    attrs,
    label: "Tool",
    prompt: "",
    shape: "parallelogram",
    type: "tool"
  };
}

describe("runner tool node execution", () => {
  it("returns static output when no command is configured", async () => {
    const runCommand = vi.fn();
    const result = await executeToolNode({
      node: node({ output: "static text" }),
      workDir: "/workspace/repo",
      runCommand,
      defaultOutput: "fallback output"
    });

    expect(result.kind).toBe("noop");
    if (result.kind !== "noop") {
      throw new Error("unexpected result kind");
    }
    expect(result.output).toBe("static text");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("executes configured command in repository cwd", async () => {
    const runCommand = vi.fn().mockResolvedValue("ok\n");
    const result = await executeToolNode({
      node: node({ tool: "shell", command: "echo ok" }),
      workDir: "/workspace/repo",
      runCommand,
      defaultOutput: "fallback output"
    });

    expect(result.kind).toBe("command_success");
    if (result.kind !== "command_success") {
      throw new Error("unexpected result kind");
    }
    expect(result.output).toBe("ok\n");
    expect(result.timeoutMs).toBeGreaterThan(0);
    expect(runCommand).toHaveBeenCalledWith(
      "bash",
      ["-lc", "echo ok"],
      "/workspace/repo",
      expect.objectContaining({ timeoutMs: result.timeoutMs })
    );
  });

  it("rejects cwd paths outside repository root", async () => {
    const runCommand = vi.fn();
    const result = await executeToolNode({
      node: node({ command: "echo ok", cwd: "../../" }),
      workDir: "/workspace/repo",
      runCommand,
      defaultOutput: "fallback output"
    });

    expect(result.kind).toBe("command_failure");
    if (result.kind !== "command_failure") {
      throw new Error("unexpected result kind");
    }
    expect(result.output.status).toBe("FAIL");
    expect(result.output.failureReason).toContain("preflight failed");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reports command failures with node outcome", async () => {
    const runCommand = vi.fn().mockRejectedValue({
      stdout: "partial\n",
      stderr: "failed\n"
    });

    const result = await executeToolNode({
      node: node({ command: "false" }),
      workDir: "/workspace/repo",
      runCommand,
      defaultOutput: "fallback output"
    });

    expect(result.kind).toBe("command_failure");
    if (result.kind !== "command_failure") {
      throw new Error("unexpected result kind");
    }
    expect(result.output.status).toBe("FAIL");
    expect(result.output.failureReason).toContain("Tool command failed");
    expect(result.output.notes).toContain("partial");
    expect(result.output.notes).toContain("failed");
  });
});
