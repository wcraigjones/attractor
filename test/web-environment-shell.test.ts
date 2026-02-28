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

  it("rejects invalid payloads", () => {
    expect(parseEnvironmentShellServerMessage("not-json")).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify({ type: "status", state: "bogus" }))).toBeNull();
    expect(parseEnvironmentShellServerMessage(JSON.stringify({}))).toBeNull();
  });
});
