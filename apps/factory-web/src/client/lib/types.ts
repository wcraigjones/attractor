export type RunType = "planning" | "implementation" | "task";
export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "TIMEOUT";
export type AttractorScope = "PROJECT" | "GLOBAL";
export type EnvironmentKind = "KUBERNETES_JOB";
export type RunQuestionStatus = "PENDING" | "ANSWERED" | "TIMEOUT";

export interface EnvironmentResources {
  requests?: {
    cpu?: string;
    memory?: string;
  };
  limits?: {
    cpu?: string;
    memory?: string;
  };
}

export interface Environment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  runnerImage: string;
  serviceAccountName: string | null;
  resourcesJson: EnvironmentResources | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunExecutionEnvironment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  runnerImage: string;
  serviceAccountName?: string;
  resources?: EnvironmentResources;
}

export type EnvironmentShellMode = "project" | "system";

export interface EnvironmentShellSessionRequest {
  mode: EnvironmentShellMode;
  projectId?: string;
  injectSecrets?: boolean;
}

export interface EnvironmentShellSession {
  id: string;
  environmentId: string;
  mode: EnvironmentShellMode;
  projectId: string | null;
  namespace: string;
  podName: string;
  injectSecrets: boolean;
  expiresAt: string;
  streamPath: string;
}

export type EnvironmentShellClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "terminate" };

export type EnvironmentShellServerMessage =
  | { type: "status"; state: "starting pod" | "connecting" | "ready" | "disconnected" | "error" }
  | { type: "output"; stream: "stdout" | "stderr"; data: string }
  | { type: "exit"; status: unknown }
  | { type: "error"; message: string };

export interface Project {
  id: string;
  name: string;
  namespace: string;
  githubInstallationId: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  defaultEnvironmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubAppStatus {
  configured: boolean;
  source: "env" | "global-secret" | "none";
  appId: string | null;
  appSlug: string | null;
  hasWebhookSecret: boolean;
  syncEnabled: boolean;
}

export interface GitHubInstallationRepo {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
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
  repoPath: string | null;
  contentPath: string | null;
  contentVersion: number;
  defaultRunType: RunType;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttractorDiagnostic {
  rule: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  nodeId?: string;
  edge?: { from: string; to: string };
  fix?: string;
}

export interface AttractorValidation {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: AttractorDiagnostic[];
}

export interface AttractorVersion {
  id: string;
  version: number;
  contentPath: string;
  contentSha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface GlobalAttractor {
  id: string;
  name: string;
  repoPath: string | null;
  contentPath: string | null;
  contentVersion: number;
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
  attractorContentPath: string | null;
  attractorContentVersion: number | null;
  attractorContentSha256: string | null;
  githubIssueId: string | null;
  githubPullRequestId: string | null;
  environmentId: string | null;
  runType: RunType;
  sourceBranch: string;
  targetBranch: string;
  status: RunStatus;
  specBundleId: string | null;
  environmentSnapshot: RunExecutionEnvironment | null;
  prUrl: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  githubIssue?: GitHubIssue | null;
  githubPullRequest?: GitHubPullRequest | null;
  events?: RunEvent[];
}

export interface GitHubIssue {
  id: string;
  projectId: string;
  issueNumber: number;
  state: string;
  title: string;
  body: string | null;
  author: string | null;
  labelsJson: unknown | null;
  assigneesJson: unknown | null;
  url: string;
  openedAt: string;
  closedAt: string | null;
  updatedAt: string;
  syncedAt: string;
  createdAt: string;
  runCount?: number;
  pullRequestCount?: number;
}

export interface GitHubPullRequest {
  id: string;
  projectId: string;
  prNumber: number;
  state: string;
  title: string;
  body: string | null;
  url: string;
  headRefName: string;
  headSha: string;
  baseRefName: string;
  mergedAt: string | null;
  openedAt: string;
  closedAt: string | null;
  updatedAt: string;
  syncedAt: string;
  linkedIssueId: string | null;
}

export interface GitHubPullQueueItem {
  pullRequest: GitHubPullRequest & { linkedIssue?: GitHubIssue | null };
  linkedRunId: string | null;
  reviewDecision: ReviewDecision | null;
  reviewStatus: "Pending" | "Completed" | "Overdue";
  risk: "low" | "medium" | "high";
  dueAt: string;
  minutesRemaining: number;
  criticalCount: number;
  artifactCount: number;
  openPackPath: string | null;
}

export interface RunQuestion {
  id: string;
  runId: string;
  nodeId: string;
  prompt: string;
  options: unknown | null;
  answer: unknown | null;
  status: RunQuestionStatus;
  createdAt: string;
  answeredAt: string | null;
}

export type ReviewDecision = "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "EXCEPTION";

export interface RunReviewChecklist {
  summaryReviewed: boolean;
  criticalCodeReviewed: boolean;
  artifactsReviewed: boolean;
  functionalValidationReviewed: boolean;
}

export interface RunReview {
  id: string;
  runId: string;
  reviewer: string;
  decision: ReviewDecision;
  checklist: RunReviewChecklist;
  summary: string | null;
  criticalFindings: string | null;
  artifactFindings: string | null;
  attestation: string | null;
  reviewedHeadSha: string | null;
  summarySnapshotJson: unknown | null;
  criticalSectionsSnapshotJson: unknown | null;
  artifactFocusSnapshotJson: unknown | null;
  githubCheckRunId: string | null;
  githubSummaryCommentId: string | null;
  githubWritebackStatus: string | null;
  githubWritebackAt: string | null;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewChecklistTemplateItem {
  key: keyof RunReviewChecklist;
  label: string;
}

export interface ReviewPackArtifact {
  id: string;
  key: string;
  path: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  priority: number;
  reason: string;
}

export interface ReviewCriticalSection {
  path: string;
  riskLevel: "high" | "medium" | "low";
  reason: string;
}

export interface RunReviewPack {
  dueAt: string;
  overdue: boolean;
  minutesRemaining: number;
  summarySuggestion: string;
  artifactFocus: ReviewPackArtifact[];
  criticalSections: ReviewCriticalSection[];
}

export interface RunReviewResponse {
  frameworkVersion: string;
  review: RunReview | null;
  checklistTemplate: ReviewChecklistTemplateItem[];
  pack: RunReviewPack;
  github?: {
    pullRequest?: GitHubPullRequest | null;
  };
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
