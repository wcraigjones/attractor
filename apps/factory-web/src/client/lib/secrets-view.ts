import type { GlobalSecret, ProjectSecret } from "./types";

export const ARBITRARY_SECRET_PROVIDER = "__arbitrary__";

export type SecretRowStatus = "Project" | "Inherited" | "Partially Overridden" | "Overridden";

export interface SecretViewRow {
  id: string;
  source: "project" | "global";
  name: string;
  provider: string;
  k8sSecretName: string;
  status: SecretRowStatus;
  muted: boolean;
}

function toLogicalKeySet(keyMappings: Record<string, string>): Set<string> {
  return new Set(Object.keys(keyMappings));
}

function secretGroupKey(secret: { provider: string; name: string }): string {
  if (secret.provider === ARBITRARY_SECRET_PROVIDER) {
    return `${secret.provider}:${secret.name}`;
  }
  return secret.provider;
}

export function formatSecretProvider(provider: string): string {
  return provider === ARBITRARY_SECRET_PROVIDER ? "arbitrary" : provider;
}

function overlapSize(first: Set<string>, second: Set<string>): number {
  let matches = 0;
  for (const key of first) {
    if (second.has(key)) {
      matches += 1;
    }
  }
  return matches;
}

export function buildProjectSecretsViewRows(
  projectSecrets: ProjectSecret[],
  globalSecrets: GlobalSecret[]
): SecretViewRow[] {
  const projectKeysByGroup = new Map<string, Set<string>>();

  for (const secret of projectSecrets) {
    const group = secretGroupKey(secret);
    const current = projectKeysByGroup.get(group) ?? new Set<string>();
    for (const logicalKey of Object.keys(secret.keyMappings)) {
      current.add(logicalKey);
    }
    projectKeysByGroup.set(group, current);
  }

  const projectRows: SecretViewRow[] = projectSecrets.map((secret) => ({
    id: `project:${secret.id}`,
    source: "project",
    name: secret.name,
    provider: secret.provider,
    k8sSecretName: secret.k8sSecretName,
    status: "Project",
    muted: false
  }));

  const globalRows: SecretViewRow[] = globalSecrets.map((secret) => {
    const globalKeys = toLogicalKeySet(secret.keyMappings);
    const projectKeys = projectKeysByGroup.get(secretGroupKey(secret)) ?? new Set<string>();
    const overlap = overlapSize(globalKeys, projectKeys);

    let status: SecretRowStatus = "Inherited";
    if (globalKeys.size === 0) {
      status = projectKeys.size > 0 ? "Overridden" : "Inherited";
    } else if (overlap === globalKeys.size) {
      status = "Overridden";
    } else if (overlap > 0) {
      status = "Partially Overridden";
    }

    return {
      id: `global:${secret.id}`,
      source: "global",
      name: secret.name,
      provider: secret.provider,
      k8sSecretName: secret.k8sSecretName,
      status,
      muted: status !== "Inherited"
    };
  });

  return [...projectRows, ...globalRows];
}
