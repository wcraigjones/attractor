export type RunType = "planning" | "implementation";
export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "TIMEOUT";
export type AttractorScope = "PROJECT" | "GLOBAL";

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

export interface GlobalSecret {
  id: string;
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
  scope: AttractorScope;
  name: string;
  repoPath: string;
  defaultRunType: RunType;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalAttractor {
  id: string;
  name: string;
  repoPath: string;
  defaultRunType: RunType;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  ts: string;
  type: string;
  payload: unknown;
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
  events?: RunEvent[];
}

export interface Artifact {
  id: string;
  runId: string;
  key: string;
  path: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
}

export interface SpecBundle {
  id: string;
  runId: string;
  schemaVersion: string;
  manifestPath: string;
  createdAt: string;
}

export interface ProviderSchema {
  provider: string;
  envByLogicalKey: Record<string, string>;
  requiredAll?: string[];
  requiredAny?: string[];
}

export interface RunModelConfig {
  provider: string;
  modelId: string;
  reasoningLevel?: "minimal" | "low" | "medium" | "high" | "xhigh";
  temperature?: number;
  maxTokens?: number;
}

export interface ArtifactContentResponse {
  artifact: {
    id: string;
    key: string;
    path: string;
    contentType?: string;
    sizeBytes?: number;
  };
  content: string | null;
  truncated: boolean;
  bytesRead: number;
  encoding: string | null;
}
