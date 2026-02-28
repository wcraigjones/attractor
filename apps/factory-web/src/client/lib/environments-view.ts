import type { Environment, Project } from "./types";

export function listActiveEnvironments(environments: Environment[]): Environment[] {
  return environments.filter((environment) => environment.active);
}

export function getInactiveDefaultEnvironment(
  project: Pick<Project, "defaultEnvironmentId"> | undefined,
  environments: Environment[]
): Environment | null {
  if (!project?.defaultEnvironmentId) {
    return null;
  }
  const selected = environments.find((environment) => environment.id === project.defaultEnvironmentId);
  if (!selected || selected.active) {
    return null;
  }
  return selected;
}
