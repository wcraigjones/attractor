import { getModels, getProviders } from "@mariozechner/pi-ai";

export interface ModelSummary {
  id: string;
  name: string;
  provider: string;
  api: string;
}

export function listModelProviders(): string[] {
  return [...getProviders()].sort((a, b) => a.localeCompare(b));
}

export function listModelsForProvider(provider: string): ModelSummary[] {
  const providers = new Set(listModelProviders());
  if (!providers.has(provider)) {
    return [];
  }

  return getModels(provider as never)
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      api: model.api
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function hasProvider(provider: string): boolean {
  return listModelProviders().includes(provider);
}

export function hasModel(provider: string, modelId: string): boolean {
  return listModelsForProvider(provider).some((model) => model.id === modelId);
}
