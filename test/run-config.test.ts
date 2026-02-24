import { describe, expect, it } from "vitest";

import { listModelProviders, listModelsForProvider } from "../src/llm/model-catalog.js";
import { RunModelConfigError, validateRunModelConfig } from "../src/run-config.js";

function getValidModelConfig() {
  const provider = listModelProviders()[0];
  if (!provider) {
    throw new Error("No providers found in pi-ai model catalog");
  }

  const model = listModelsForProvider(provider)[0];
  if (!model) {
    throw new Error(`No models found for provider ${provider}`);
  }

  return { provider, modelId: model.id };
}

describe("run model config validation", () => {
  it("accepts a provider/model from pi-ai catalog", () => {
    const config = validateRunModelConfig({
      ...getValidModelConfig(),
      reasoningLevel: "high",
      temperature: 0.2,
      maxTokens: 1024
    });

    expect(config.model.provider).toBe(config.provider);
    expect(config.model.id).toBe(config.modelId);
  });

  it("fails fast for unknown providers", () => {
    expect(() =>
      validateRunModelConfig({
        provider: "not-a-real-provider",
        modelId: "anything"
      })
    ).toThrowError(RunModelConfigError);
  });

  it("fails fast for unknown models", () => {
    const { provider } = getValidModelConfig();
    expect(() =>
      validateRunModelConfig({
        provider,
        modelId: "not-a-real-model"
      })
    ).toThrowError(RunModelConfigError);
  });
});
