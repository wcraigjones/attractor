import { describe, expect, it } from "vitest";

import {
  defaultReviewChecklistValue,
  extractCriticalSectionsFromDiff,
  rankReviewArtifacts,
  reviewSlaStatus,
  runReviewDueAt,
  summarizeImplementationNote
} from "../apps/factory-api/src/run-review.js";

describe("run review framework helpers", () => {
  it("computes review SLA windows from run creation", () => {
    const createdAt = new Date("2026-02-28T00:00:00.000Z");
    const dueAt = runReviewDueAt(createdAt);
    expect(dueAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");

    const status = reviewSlaStatus(createdAt, new Date("2026-02-28T12:00:00.000Z"));
    expect(status.overdue).toBe(false);
    expect(status.minutesRemaining).toBe(720);
  });

  it("extracts and risk-ranks critical sections from unified diff text", () => {
    const diff = [
      "diff --git a/src/auth/session.ts b/src/auth/session.ts",
      "index 1111111..2222222 100644",
      "--- a/src/auth/session.ts",
      "+++ b/src/auth/session.ts",
      "@@ -1,2 +1,2 @@",
      "diff --git a/src/ui/theme.ts b/src/ui/theme.ts",
      "index 3333333..4444444 100644",
      "--- a/src/ui/theme.ts",
      "+++ b/src/ui/theme.ts"
    ].join("\n");

    const sections = extractCriticalSectionsFromDiff(diff);
    expect(sections.map((item) => item.path)).toEqual(["src/auth/session.ts", "src/ui/theme.ts"]);
    expect(sections[0]).toMatchObject({
      riskLevel: "high"
    });
    expect(sections[1]).toMatchObject({
      riskLevel: "low"
    });
  });

  it("prioritizes review artifacts using task-review framework defaults", () => {
    const ranked = rankReviewArtifacts([
      {
        id: "a-2",
        key: "implementation-note.md",
        path: "runs/proj/run/implementation-note.md"
      },
      {
        id: "a-1",
        key: "implementation.patch",
        path: "runs/proj/run/implementation.patch"
      },
      {
        id: "a-3",
        key: "log.txt",
        path: "runs/proj/run/log.txt"
      }
    ]);

    expect(ranked.map((item) => item.key)).toEqual([
      "implementation.patch",
      "implementation-note.md",
      "log.txt"
    ]);
  });

  it("keeps summary snippets bounded and exposes checklist defaults", () => {
    expect(summarizeImplementationNote("First paragraph.\n\nSecond paragraph.")).toBe("First paragraph.");
    expect(defaultReviewChecklistValue()).toEqual({
      summaryReviewed: false,
      criticalCodeReviewed: false,
      artifactsReviewed: false,
      functionalValidationReviewed: false
    });
  });
});
