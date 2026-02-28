import { ARBITRARY_SECRET_PROVIDER } from "./secrets-view";

export const SETUP_WIZARD_STORAGE_KEY = "factory.setupWizard.v1";
export const SETUP_WIZARD_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SETUP_WIZARD_STEPS = ["project", "github", "secrets", "attractor", "run", "done"] as const;
export const SETUP_WIZARD_REQUIRED_STEPS = ["project", "secrets", "attractor", "run"] as const;
const RUN_REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
const ATTRACTOR_RUN_TYPES = ["planning", "implementation", "task"] as const;

export type SetupWizardStep = (typeof SETUP_WIZARD_STEPS)[number];
export type SetupWizardRequiredStep = (typeof SETUP_WIZARD_REQUIRED_STEPS)[number];
export type SetupWizardRunReasoningLevel = (typeof RUN_REASONING_LEVELS)[number];
export type SetupWizardAttractorRunType = (typeof ATTRACTOR_RUN_TYPES)[number];

export interface SetupWizardReadiness {
  projectComplete: boolean;
  secretsComplete: boolean;
  attractorComplete: boolean;
  runComplete: boolean;
  allRequiredComplete: boolean;
}

export interface SetupWizardReadinessInput {
  projectId?: string;
  projectSecretProviders: string[];
  globalSecretProviders: string[];
  attractors: Array<{ active: boolean; contentPath: string | null }>;
  runCount: number;
}

export interface SetupWizardEntryDraft {
  selectedProjectId?: string;
  projectName?: string;
  namespace?: string;
}

export interface SetupWizardGitHubDraft {
  installationId?: string;
  repoFullName?: string;
  defaultBranch?: string;
  selectedRepoFullName?: string;
}

export interface SetupWizardSecretsDraft {
  provider?: string;
  name?: string;
  logicalKey?: string;
  secretKey?: string;
}

export interface SetupWizardAttractorDraft {
  selectedAttractorId?: string;
  name?: string;
  sourceLabel?: string;
  content?: string;
  defaultRunType?: SetupWizardAttractorRunType;
  description?: string;
}

export interface SetupWizardRunDraft {
  provider?: string;
  modelId?: string;
  sourceBranch?: string;
  targetBranch?: string;
  reasoningLevel?: SetupWizardRunReasoningLevel;
  temperature?: string;
  maxTokens?: string;
  showAdvanced?: boolean;
}

export interface SetupWizardProjectDraft {
  lastStep?: SetupWizardStep;
  github?: SetupWizardGitHubDraft;
  secrets?: SetupWizardSecretsDraft;
  attractor?: SetupWizardAttractorDraft;
  run?: SetupWizardRunDraft;
  lastRunId?: string;
}

export interface SetupWizardDraft {
  entry: SetupWizardEntryDraft;
  projects: Record<string, SetupWizardProjectDraft>;
}

export interface SetupWizardStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface SetupWizardStorageOptions {
  storage?: SetupWizardStorageLike;
  nowMs?: number;
}

interface SetupWizardEntryPersisted {
  data: SetupWizardEntryDraft;
  updatedAtMs: number;
}

interface SetupWizardProjectPersisted {
  data: SetupWizardProjectDraft;
  updatedAtMs: number;
}

interface SetupWizardPersisted {
  version: 1;
  entry?: SetupWizardEntryPersisted;
  projects: Record<string, SetupWizardProjectPersisted>;
}

function getStorage(storage: SetupWizardStorageLike | undefined): SetupWizardStorageLike | null {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function isSetupWizardStepValue(value: string): value is SetupWizardStep {
  return (SETUP_WIZARD_STEPS as readonly string[]).includes(value);
}

function isReasoningLevelValue(value: string): value is SetupWizardRunReasoningLevel {
  return (RUN_REASONING_LEVELS as readonly string[]).includes(value);
}

function isAttractorRunTypeValue(value: string): value is SetupWizardAttractorRunType {
  return (ATTRACTOR_RUN_TYPES as readonly string[]).includes(value);
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toBooleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeGitHubDraft(input: unknown): SetupWizardGitHubDraft | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const installationId = toStringValue(record.installationId);
  const repoFullName = toStringValue(record.repoFullName);
  const defaultBranch = toStringValue(record.defaultBranch);
  const selectedRepoFullName = toStringValue(record.selectedRepoFullName);

  const draft: SetupWizardGitHubDraft = {
    ...(installationId !== undefined ? { installationId } : {}),
    ...(repoFullName !== undefined ? { repoFullName } : {}),
    ...(defaultBranch !== undefined ? { defaultBranch } : {}),
    ...(selectedRepoFullName !== undefined ? { selectedRepoFullName } : {})
  };

  return Object.keys(draft).length > 0 ? draft : undefined;
}

function sanitizeSecretsDraft(input: unknown): SetupWizardSecretsDraft | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const provider = toStringValue(record.provider);
  const name = toStringValue(record.name);
  const logicalKey = toStringValue(record.logicalKey);
  const secretKey = toStringValue(record.secretKey);

  const draft: SetupWizardSecretsDraft = {
    ...(provider !== undefined ? { provider } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(logicalKey !== undefined ? { logicalKey } : {}),
    ...(secretKey !== undefined ? { secretKey } : {})
  };

  return Object.keys(draft).length > 0 ? draft : undefined;
}

function sanitizeAttractorDraft(input: unknown): SetupWizardAttractorDraft | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const selectedAttractorId = toStringValue(record.selectedAttractorId);
  const name = toStringValue(record.name);
  const sourceLabel = toStringValue(record.sourceLabel);
  const content = toStringValue(record.content);
  const defaultRunTypeRaw = toStringValue(record.defaultRunType);
  const description = toStringValue(record.description);

  const draft: SetupWizardAttractorDraft = {
    ...(selectedAttractorId !== undefined ? { selectedAttractorId } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(sourceLabel !== undefined ? { sourceLabel } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(defaultRunTypeRaw && isAttractorRunTypeValue(defaultRunTypeRaw) ? { defaultRunType: defaultRunTypeRaw } : {}),
    ...(description !== undefined ? { description } : {})
  };

  return Object.keys(draft).length > 0 ? draft : undefined;
}

function sanitizeRunDraft(input: unknown): SetupWizardRunDraft | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const provider = toStringValue(record.provider);
  const modelId = toStringValue(record.modelId);
  const sourceBranch = toStringValue(record.sourceBranch);
  const targetBranch = toStringValue(record.targetBranch);
  const reasoningLevelRaw = toStringValue(record.reasoningLevel);
  const temperature = toStringValue(record.temperature);
  const maxTokens = toStringValue(record.maxTokens);
  const showAdvanced = toBooleanValue(record.showAdvanced);

  const draft: SetupWizardRunDraft = {
    ...(provider !== undefined ? { provider } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(sourceBranch !== undefined ? { sourceBranch } : {}),
    ...(targetBranch !== undefined ? { targetBranch } : {}),
    ...(reasoningLevelRaw && isReasoningLevelValue(reasoningLevelRaw) ? { reasoningLevel: reasoningLevelRaw } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(showAdvanced !== undefined ? { showAdvanced } : {})
  };

  return Object.keys(draft).length > 0 ? draft : undefined;
}

function sanitizeEntryDraft(input: unknown): SetupWizardEntryDraft {
  if (!input || typeof input !== "object") {
    return {};
  }
  const record = input as Record<string, unknown>;
  const selectedProjectId = toStringValue(record.selectedProjectId);
  const projectName = toStringValue(record.projectName);
  const namespace = toStringValue(record.namespace);

  return {
    ...(selectedProjectId !== undefined ? { selectedProjectId } : {}),
    ...(projectName !== undefined ? { projectName } : {}),
    ...(namespace !== undefined ? { namespace } : {})
  };
}

function sanitizeProjectDraft(input: unknown): SetupWizardProjectDraft {
  if (!input || typeof input !== "object") {
    return {};
  }

  const record = input as Record<string, unknown>;
  const lastStepRaw = toStringValue(record.lastStep);
  const lastRunId = toStringValue(record.lastRunId);
  const github = sanitizeGitHubDraft(record.github);
  const secrets = sanitizeSecretsDraft(record.secrets);
  const attractor = sanitizeAttractorDraft(record.attractor);
  const run = sanitizeRunDraft(record.run);

  return {
    ...(lastStepRaw && isSetupWizardStepValue(lastStepRaw) ? { lastStep: lastStepRaw } : {}),
    ...(github ? { github } : {}),
    ...(secrets ? { secrets } : {}),
    ...(attractor ? { attractor } : {}),
    ...(run ? { run } : {}),
    ...(lastRunId !== undefined ? { lastRunId } : {})
  };
}

function isExpired(updatedAtMs: number, nowMs: number): boolean {
  return nowMs - updatedAtMs > SETUP_WIZARD_DRAFT_TTL_MS;
}

function readPersisted(options: SetupWizardStorageOptions = {}): {
  persisted: SetupWizardPersisted;
  changed: boolean;
  storage: SetupWizardStorageLike | null;
} {
  const storage = getStorage(options.storage);
  const nowMs = options.nowMs ?? Date.now();
  const empty: SetupWizardPersisted = {
    version: 1,
    projects: {}
  };

  if (!storage) {
    return {
      persisted: empty,
      changed: false,
      storage: null
    };
  }

  const raw = storage.getItem(SETUP_WIZARD_STORAGE_KEY);
  if (!raw) {
    return {
      persisted: empty,
      changed: false,
      storage
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(SETUP_WIZARD_STORAGE_KEY);
    return {
      persisted: empty,
      changed: true,
      storage
    };
  }

  const record = parsed as Record<string, unknown>;
  const entryRecord = record.entry as { data?: unknown; updatedAtMs?: unknown } | undefined;
  const projectsRecord = record.projects as Record<string, { data?: unknown; updatedAtMs?: unknown }> | undefined;

  let changed = false;

  let entry: SetupWizardEntryPersisted | undefined;
  if (entryRecord && typeof entryRecord === "object") {
    const entryUpdatedAt = typeof entryRecord.updatedAtMs === "number" ? entryRecord.updatedAtMs : 0;
    if (!entryUpdatedAt || isExpired(entryUpdatedAt, nowMs)) {
      changed = true;
    } else {
      entry = {
        data: sanitizeEntryDraft(entryRecord.data),
        updatedAtMs: entryUpdatedAt
      };
    }
  }

  const projects: Record<string, SetupWizardProjectPersisted> = {};
  for (const [projectId, projectValue] of Object.entries(projectsRecord ?? {})) {
    if (!projectValue || typeof projectValue !== "object") {
      changed = true;
      continue;
    }

    const updatedAtMs = typeof projectValue.updatedAtMs === "number" ? projectValue.updatedAtMs : 0;
    if (!updatedAtMs || isExpired(updatedAtMs, nowMs)) {
      changed = true;
      continue;
    }

    projects[projectId] = {
      data: sanitizeProjectDraft(projectValue.data),
      updatedAtMs
    };
  }

  const persisted: SetupWizardPersisted = {
    version: 1,
    ...(entry ? { entry } : {}),
    projects
  };

  return {
    persisted,
    changed,
    storage
  };
}

function writePersisted(persisted: SetupWizardPersisted, options: SetupWizardStorageOptions = {}): void {
  const storage = getStorage(options.storage);
  if (!storage) {
    return;
  }

  if (!persisted.entry && Object.keys(persisted.projects).length === 0) {
    storage.removeItem(SETUP_WIZARD_STORAGE_KEY);
    return;
  }

  storage.setItem(SETUP_WIZARD_STORAGE_KEY, JSON.stringify(persisted));
}

export function parseSetupWizardStep(value: string | null | undefined, fallback: SetupWizardStep): SetupWizardStep {
  if (!value) {
    return fallback;
  }
  return isSetupWizardStepValue(value) ? value : fallback;
}

export function deriveSetupWizardReadiness(input: SetupWizardReadinessInput): SetupWizardReadiness {
  const projectComplete = Boolean(input.projectId);
  const secretsComplete = [...input.projectSecretProviders, ...input.globalSecretProviders].some(
    (provider) => provider !== ARBITRARY_SECRET_PROVIDER
  );
  const attractorComplete = input.attractors.some((attractor) => attractor.active && Boolean(attractor.contentPath));
  const runComplete = input.runCount > 0;

  return {
    projectComplete,
    secretsComplete,
    attractorComplete,
    runComplete,
    allRequiredComplete: projectComplete && secretsComplete && attractorComplete && runComplete
  };
}

export function firstIncompleteRequiredStep(readiness: SetupWizardReadiness): SetupWizardRequiredStep | "done" {
  if (!readiness.projectComplete) {
    return "project";
  }
  if (!readiness.secretsComplete) {
    return "secrets";
  }
  if (!readiness.attractorComplete) {
    return "attractor";
  }
  if (!readiness.runComplete) {
    return "run";
  }
  return "done";
}

export function readSetupWizardDraft(options: SetupWizardStorageOptions = {}): SetupWizardDraft {
  const { persisted, changed, storage } = readPersisted(options);
  if (changed && storage) {
    writePersisted(persisted, { storage });
  }

  return {
    entry: persisted.entry?.data ?? {},
    projects: Object.fromEntries(
      Object.entries(persisted.projects).map(([projectId, record]) => [projectId, record.data])
    )
  };
}

export function saveSetupWizardEntryDraft(entryDraft: SetupWizardEntryDraft, options: SetupWizardStorageOptions = {}): void {
  const nowMs = options.nowMs ?? Date.now();
  const { persisted } = readPersisted(options);
  persisted.entry = {
    data: sanitizeEntryDraft(entryDraft),
    updatedAtMs: nowMs
  };
  writePersisted(persisted, options);
}

export function clearSetupWizardEntryDraft(options: SetupWizardStorageOptions = {}): void {
  const { persisted } = readPersisted(options);
  delete persisted.entry;
  writePersisted(persisted, options);
}

export function saveSetupWizardProjectDraft(
  projectId: string,
  projectDraft: SetupWizardProjectDraft,
  options: SetupWizardStorageOptions = {}
): void {
  if (!projectId) {
    return;
  }

  const nowMs = options.nowMs ?? Date.now();
  const { persisted } = readPersisted(options);
  persisted.projects[projectId] = {
    data: sanitizeProjectDraft(projectDraft),
    updatedAtMs: nowMs
  };
  writePersisted(persisted, options);
}

export function clearSetupWizardProjectDraft(projectId: string, options: SetupWizardStorageOptions = {}): void {
  if (!projectId) {
    return;
  }

  const { persisted } = readPersisted(options);
  delete persisted.projects[projectId];
  writePersisted(persisted, options);
}
