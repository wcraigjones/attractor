import { getModel, type Api, type Model, type ThinkingLevel } from "@mariozechner/pi-ai";

import { hasModel, hasProvider } from "./llm/model-catalog.js";

export interface RunModelConfig {
  provider: string;
  modelId: string;
  reasoningLevel?: ThinkingLevel;
  temperature?: number;
  maxTokens?: number;
}

export interface ValidatedRunModelConfig extends RunModelConfig {
  model: Model<Api>;
}

export class RunModelConfigError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_PROVIDER"
      | "INVALID_MODEL"
      | "INVALID_REASONING_LEVEL"
      | "INVALID_TEMPERATURE"
      | "INVALID_MAX_TOKENS"
  ) {
    super(message);
    this.name = "RunModelConfigError";
  }
}

const reasoningLevels: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];

export function validateRunModelConfig(config: RunModelConfig): ValidatedRunModelConfig {
  if (!hasProvider(config.provider)) {
    throw new RunModelConfigError(`Unknown provider: ${config.provider}`, "INVALID_PROVIDER");
  }

  if (!hasModel(config.provider, config.modelId)) {
    throw new RunModelConfigError(
      `Unknown model "${config.modelId}" for provider "${config.provider}"`,
      "INVALID_MODEL"
    );
  }

  if (config.reasoningLevel && !reasoningLevels.includes(config.reasoningLevel)) {
    throw new RunModelConfigError(
      `Invalid reasoningLevel: ${config.reasoningLevel}`,
      "INVALID_REASONING_LEVEL"
    );
  }

  if (config.temperature !== undefined && (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2)) {
    throw new RunModelConfigError(
      "temperature must be a finite number between 0 and 2",
      "INVALID_TEMPERATURE"
    );
  }

  if (
    config.maxTokens !== undefined &&
    (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0)
  ) {
    throw new RunModelConfigError(
      "maxTokens must be a positive integer",
      "INVALID_MAX_TOKENS"
    );
  }

  const model = getModel(config.provider as never, config.modelId as never) as
    | Model<Api>
    | undefined;

  if (!model) {
    throw new RunModelConfigError(
      `Model lookup failed for "${config.provider}/${config.modelId}"`,
      "INVALID_MODEL"
    );
  }

  return {
    ...config,
    model
  };
}
