import { describe, expect, it } from "vitest";

import {
  buildEffectiveTaskTemplates,
  buildTaskTemplateViewRows
} from "../apps/factory-web/src/client/lib/task-templates-view";
import type { TaskTemplate } from "../apps/factory-web/src/client/lib/types";

function template(input: Partial<TaskTemplate> & { id: string; name: string; scope: "PROJECT" | "GLOBAL" }): TaskTemplate {
  return {
    id: input.id,
    projectId: input.projectId ?? "proj-1",
    scope: input.scope,
    name: input.name,
    attractorName: input.attractorName ?? "default-attractor",
    runType: input.runType ?? "task",
    sourceBranch: input.sourceBranch ?? "main",
    targetBranch: input.targetBranch ?? "main",
    environmentMode: input.environmentMode ?? "PROJECT_DEFAULT",
    environmentName: input.environmentName ?? null,
    scheduleEnabled: input.scheduleEnabled ?? false,
    scheduleCron: input.scheduleCron ?? null,
    scheduleTimezone: input.scheduleTimezone ?? null,
    scheduleNextRunAt: input.scheduleNextRunAt ?? null,
    scheduleLastRunAt: input.scheduleLastRunAt ?? null,
    scheduleLastError: input.scheduleLastError ?? null,
    triggersJson: input.triggersJson ?? null,
    description: input.description ?? null,
    active: input.active ?? true,
    createdAt: input.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-03-01T00:00:00.000Z"
  };
}

describe("task templates view helpers", () => {
  it("keeps project templates and non-overridden globals", () => {
    const rows = buildEffectiveTaskTemplates([
      template({ id: "g1", scope: "GLOBAL", name: "plan" }),
      template({ id: "p1", scope: "PROJECT", name: "plan" }),
      template({ id: "g2", scope: "GLOBAL", name: "review" })
    ]);

    expect(rows.map((row) => row.id)).toEqual(["p1", "g2"]);
  });

  it("marks overridden global rows as muted", () => {
    const rows = buildTaskTemplateViewRows([
      template({ id: "g1", scope: "GLOBAL", name: "plan" }),
      template({ id: "p1", scope: "PROJECT", name: "plan" })
    ]);

    const globalRow = rows.find((row) => row.taskTemplateId === "g1");
    const projectRow = rows.find((row) => row.taskTemplateId === "p1");

    expect(globalRow?.status).toBe("Overridden");
    expect(globalRow?.muted).toBe(true);
    expect(projectRow?.status).toBe("Project");
    expect(projectRow?.muted).toBe(false);
  });

  it("marks non-overridden globals as Inherited", () => {
    const rows = buildTaskTemplateViewRows([
      template({ id: "g1", scope: "GLOBAL", name: "review" })
    ]);

    expect(rows[0]?.status).toBe("Inherited");
    expect(rows[0]?.muted).toBe(false);
    expect(rows[0]?.source).toBe("global");
  });

  it("returns empty array for empty input", () => {
    expect(buildEffectiveTaskTemplates([])).toEqual([]);
    expect(buildTaskTemplateViewRows([])).toEqual([]);
  });

  it("populates view row fields from template data", () => {
    const rows = buildTaskTemplateViewRows([
      template({
        id: "p1",
        scope: "PROJECT",
        name: "deploy",
        attractorName: "deploy-attractor",
        runType: "implementation",
        active: false,
        scheduleEnabled: true,
        scheduleNextRunAt: "2026-03-02T12:00:00Z"
      })
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "project:p1",
      taskTemplateId: "p1",
      source: "project",
      name: "deploy",
      attractorName: "deploy-attractor",
      runType: "implementation",
      active: false,
      scheduleEnabled: true,
      scheduleNextRunAt: "2026-03-02T12:00:00Z",
      status: "Project"
    });
  });

  it("keeps all globals when no project templates exist", () => {
    const rows = buildEffectiveTaskTemplates([
      template({ id: "g1", scope: "GLOBAL", name: "plan" }),
      template({ id: "g2", scope: "GLOBAL", name: "review" })
    ]);

    expect(rows.map((row) => row.id)).toEqual(["g1", "g2"]);
  });
});
