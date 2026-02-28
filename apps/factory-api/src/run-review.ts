export const RUN_REVIEW_FRAMEWORK_VERSION = "v1";
export const RUN_REVIEW_SLA_HOURS = 24;

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

export interface ReviewChecklistTemplateItem {
  key: "summaryReviewed" | "criticalCodeReviewed" | "artifactsReviewed" | "functionalValidationReviewed";
  label: string;
}

export interface ReviewChecklistValue {
  summaryReviewed: boolean;
  criticalCodeReviewed: boolean;
  artifactsReviewed: boolean;
  functionalValidationReviewed: boolean;
}

const RISK_PATH_PATTERNS: Array<{ pattern: RegExp; riskLevel: "high" | "medium" | "low"; reason: string }> = [
  { pattern: /(auth|permission|rbac|token|oauth|jwt|security)/i, riskLevel: "high", reason: "Auth or security-sensitive change" },
  { pattern: /(migration|schema|prisma|database|db)/i, riskLevel: "high", reason: "Data model or migration change" },
  { pattern: /(payment|billing|invoice|money)/i, riskLevel: "high", reason: "Financial behavior change" },
  { pattern: /(api|router|controller|handler|contract)/i, riskLevel: "medium", reason: "API behavior or contract change" },
  { pattern: /(deploy|helm|k8s|terraform|infra|docker)/i, riskLevel: "medium", reason: "Infrastructure/deployment change" }
];

const ARTIFACT_PRIORITY: Array<{ key: string; priority: number; reason: string }> = [
  { key: "implementation.patch", priority: 100, reason: "Source diff to review critical code sections" },
  { key: "implementation-note.md", priority: 90, reason: "Implementation summary and rationale" },
  { key: "plan.md", priority: 80, reason: "Original intent and acceptance criteria" },
  { key: "acceptance-tests.md", priority: 70, reason: "Verification scope and expected behavior" },
  { key: "tasks.json", priority: 60, reason: "Task decomposition and scope boundaries" },
  { key: "requirements.md", priority: 55, reason: "Requirement-level context" }
];

const REVIEW_CHECKLIST_TEMPLATE: ReviewChecklistTemplateItem[] = [
  { key: "summaryReviewed", label: "I reviewed the generated context summary" },
  { key: "criticalCodeReviewed", label: "I reviewed critical code sections and risk-bearing paths" },
  { key: "artifactsReviewed", label: "I reviewed build/test artifacts and evidence attachments" },
  { key: "functionalValidationReviewed", label: "I verified expected functional behavior" }
];

export function reviewChecklistTemplate(): ReviewChecklistTemplateItem[] {
  return REVIEW_CHECKLIST_TEMPLATE;
}

export function defaultReviewChecklistValue(): ReviewChecklistValue {
  return {
    summaryReviewed: false,
    criticalCodeReviewed: false,
    artifactsReviewed: false,
    functionalValidationReviewed: false
  };
}

export function runReviewDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + RUN_REVIEW_SLA_HOURS * 60 * 60 * 1000);
}

export function reviewSlaStatus(createdAt: Date, now = new Date()): {
  dueAt: Date;
  overdue: boolean;
  minutesRemaining: number;
} {
  const dueAt = runReviewDueAt(createdAt);
  const minutesRemaining = Math.ceil((dueAt.getTime() - now.getTime()) / 60000);
  return {
    dueAt,
    overdue: minutesRemaining < 0,
    minutesRemaining
  };
}

function classifyPathRisk(path: string): ReviewCriticalSection {
  for (const rule of RISK_PATH_PATTERNS) {
    if (rule.pattern.test(path)) {
      return {
        path,
        riskLevel: rule.riskLevel,
        reason: rule.reason
      };
    }
  }
  return {
    path,
    riskLevel: "low",
    reason: "General code path change"
  };
}

function riskSortWeight(level: "high" | "medium" | "low"): number {
  if (level === "high") {
    return 3;
  }
  if (level === "medium") {
    return 2;
  }
  return 1;
}

export function extractCriticalSectionsFromDiff(diffText: string): ReviewCriticalSection[] {
  const matches = [...diffText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)];
  const uniquePaths = new Set<string>();
  for (const match of matches) {
    const path = (match[2] ?? match[1] ?? "").trim();
    if (path.length > 0) {
      uniquePaths.add(path);
    }
  }

  return [...uniquePaths]
    .map((path) => classifyPathRisk(path))
    .sort((a, b) => {
      const riskDelta = riskSortWeight(b.riskLevel) - riskSortWeight(a.riskLevel);
      if (riskDelta !== 0) {
        return riskDelta;
      }
      return a.path.localeCompare(b.path);
    });
}

export function summarizeImplementationNote(raw: string): string {
  const compact = raw.replace(/\r/g, "").trim();
  if (!compact) {
    return "";
  }

  const firstParagraph = compact.split(/\n\s*\n/)[0] ?? compact;
  if (firstParagraph.length <= 800) {
    return firstParagraph;
  }
  return `${firstParagraph.slice(0, 797)}...`;
}

export function rankReviewArtifacts(
  artifacts: Array<{
    id: string;
    key: string;
    path: string;
    contentType?: string | null;
    sizeBytes?: number | null;
  }>
): ReviewPackArtifact[] {
  return artifacts
    .map((artifact) => {
      const matched = ARTIFACT_PRIORITY.find((item) => item.key === artifact.key);
      if (matched) {
        return {
          ...artifact,
          priority: matched.priority,
          reason: matched.reason
        };
      }
      return {
        ...artifact,
        priority: 10,
        reason: "Supplementary execution artifact"
      };
    })
    .sort((a, b) => {
      const priorityDelta = b.priority - a.priority;
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return a.key.localeCompare(b.key);
    });
}
