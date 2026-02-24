import { describe, expect, it } from "vitest";

import { runtimeInfo } from "../src/index.js";

describe("runtime info", () => {
  it("exposes a baseline spec marker", () => {
    expect(runtimeInfo.name).toBe("attractor");
    expect(runtimeInfo.baselineSpec).toBe("attractor-spec.md");
    expect(runtimeInfo.llmRuntime).toBe("@mariozechner/pi-ai");
  });
});
