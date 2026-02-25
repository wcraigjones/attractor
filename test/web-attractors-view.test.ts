import { describe, expect, it } from "vitest";

import {
  buildEffectiveAttractors,
  buildProjectAttractorsViewRows
} from "../apps/factory-web/src/client/lib/attractors-view";
import type { AttractorDef } from "../apps/factory-web/src/client/lib/types";

function attractor(input: {
  id: string;
  scope: "PROJECT" | "GLOBAL";
  name: string;
}): AttractorDef {
  return {
    id: input.id,
    projectId: "proj-1",
    scope: input.scope,
    name: input.name,
    repoPath: `${input.name}.dot`,
    defaultRunType: "planning",
    description: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("project attractors view rows", () => {
  it("keeps global rows inherited when project does not override by name", () => {
    const rows = buildProjectAttractorsViewRows([attractor({ id: "g1", scope: "GLOBAL", name: "global-a" })]);
    expect(rows[0]).toMatchObject({
      id: "global:g1",
      source: "global",
      status: "Inherited",
      muted: false
    });
  });

  it("marks global rows overridden when project row shares the same name", () => {
    const rows = buildProjectAttractorsViewRows([
      attractor({ id: "p1", scope: "PROJECT", name: "shared" }),
      attractor({ id: "g1", scope: "GLOBAL", name: "shared" })
    ]);

    const globalRow = rows.find((row) => row.id === "global:g1");
    expect(globalRow).toMatchObject({
      source: "global",
      status: "Overridden",
      muted: true
    });
  });

  it("builds run-ready effective rows with project override precedence", () => {
    const effective = buildEffectiveAttractors([
      attractor({ id: "p1", scope: "PROJECT", name: "shared" }),
      attractor({ id: "g1", scope: "GLOBAL", name: "shared" }),
      attractor({ id: "g2", scope: "GLOBAL", name: "global-only" })
    ]);

    expect(effective.map((item) => item.id)).toEqual(["p1", "g2"]);
  });
});
