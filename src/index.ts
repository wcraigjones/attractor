export interface AttractorRuntimeInfo {
  name: string;
  baselineSpec: string;
  llmRuntime: string;
}

export const runtimeInfo: AttractorRuntimeInfo = {
  name: "attractor",
  baselineSpec: "attractor-spec.md",
  llmRuntime: "@mariozechner/pi-ai"
};

export * from "./api/server.js";
export * from "./llm/model-catalog.js";
export * from "./run-config.js";
export * from "./runner/codergen.js";
export * from "./secrets/provider-env.js";
