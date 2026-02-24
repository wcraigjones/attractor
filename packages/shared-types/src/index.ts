export type RunType = "planning" | "implementation";

export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "TIMEOUT";

export interface RunModelConfig {
  provider: string;
  modelId: string;
  reasoningLevel?: "minimal" | "low" | "medium" | "high" | "xhigh";
  temperature?: number;
  maxTokens?: number;
}

export interface Project {
  id: string;
  name: string;
  namespace: string;
  githubInstallationId: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSecret {
  id: string;
  projectId: string;
  name: string;
  provider: string;
  k8sSecretName: string;
  keyMappings: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface AttractorDef {
  id: string;
  projectId: string;
  name: string;
  repoPath: string;
  defaultRunType: RunType;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  attractorDefId: string;
  runType: RunType;
  sourceBranch: string;
  targetBranch: string;
  status: RunStatus;
  specBundleId: string | null;
  prUrl: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SpecBundle {
  id: string;
  runId: string;
  schemaVersion: string;
  manifestPath: string;
  createdAt: string;
}

export interface Artifact {
  id: string;
  runId: string;
  key: string;
  path: string;
  createdAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  ts: string;
  type: string;
  payload: unknown;
}

export interface RunExecutionSpec {
  runId: string;
  projectId: string;
  runType: RunType;
  attractorDefId: string;
  sourceBranch: string;
  targetBranch: string;
  specBundleId?: string;
  modelConfig: RunModelConfig;
  secretsRef: string[];
  artifactPrefix: string;
}

export interface RunResult {
  runId: string;
  status: Extract<RunStatus, "SUCCEEDED" | "FAILED" | "CANCELED" | "TIMEOUT">;
  prUrl?: string;
  artifactManifestPath?: string;
  summary: string;
}

export function runQueueKey(): string {
  return "runs:queued";
}

export function runLockKey(projectId: string, branch: string): string {
  return `runs:lock:${projectId}:${branch}`;
}

export function runEventChannel(runId: string): string {
  return `runs:events:${runId}`;
}

export function runCancelKey(runId: string): string {
  return `runs:cancel:${runId}`;
}
