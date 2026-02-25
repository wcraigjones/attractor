export const GLOBAL_SCOPE_VALUE = "__global__";

export interface ScopeOption {
  value: string;
  label: string;
}

export function isGlobalSecretsPath(pathname: string): boolean {
  return pathname === "/secrets/global" || pathname.startsWith("/secrets/global/");
}

export function resolveSelectedScope(input: {
  pathname: string;
  projectIdFromPath?: string;
  fallbackProjectId?: string;
}): string | undefined {
  if (isGlobalSecretsPath(input.pathname)) {
    return GLOBAL_SCOPE_VALUE;
  }
  if (input.projectIdFromPath) {
    return input.projectIdFromPath;
  }
  return input.fallbackProjectId;
}

export function scopeToPath(scope: string): string {
  if (scope === GLOBAL_SCOPE_VALUE) {
    return "/secrets/global";
  }
  return `/projects/${scope}`;
}

export function buildScopeOptions(projects: Array<{ id: string; name: string }>): ScopeOption[] {
  return [
    { value: GLOBAL_SCOPE_VALUE, label: "Global" },
    ...projects.map((project) => ({ value: project.id, label: project.name }))
  ];
}
