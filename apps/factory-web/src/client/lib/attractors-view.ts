import type { AttractorDef } from "./types";

export type AttractorRowStatus = "Project" | "Inherited" | "Overridden";

export interface AttractorViewRow {
  id: string;
  source: "project" | "global";
  name: string;
  repoPath: string;
  defaultRunType: AttractorDef["defaultRunType"];
  active: boolean;
  status: AttractorRowStatus;
  muted: boolean;
}

function isProjectAttractor(attractor: AttractorDef): boolean {
  return attractor.scope === "PROJECT";
}

export function buildEffectiveAttractors(attractors: AttractorDef[]): AttractorDef[] {
  const projectByName = new Set(
    attractors.filter((attractor) => isProjectAttractor(attractor)).map((attractor) => attractor.name)
  );

  return attractors.filter((attractor) => {
    if (isProjectAttractor(attractor)) {
      return true;
    }
    return !projectByName.has(attractor.name);
  });
}

export function buildProjectAttractorsViewRows(attractors: AttractorDef[]): AttractorViewRow[] {
  const projectByName = new Set(
    attractors.filter((attractor) => isProjectAttractor(attractor)).map((attractor) => attractor.name)
  );

  const projectRows: AttractorViewRow[] = attractors
    .filter((attractor) => isProjectAttractor(attractor))
    .map((attractor) => ({
      id: `project:${attractor.id}`,
      source: "project",
      name: attractor.name,
      repoPath: attractor.repoPath,
      defaultRunType: attractor.defaultRunType,
      active: attractor.active,
      status: "Project",
      muted: false
    }));

  const globalRows: AttractorViewRow[] = attractors
    .filter((attractor) => !isProjectAttractor(attractor))
    .map((attractor) => {
      const overridden = projectByName.has(attractor.name);
      return {
        id: `global:${attractor.id}`,
        source: "global" as const,
        name: attractor.name,
        repoPath: attractor.repoPath,
        defaultRunType: attractor.defaultRunType,
        active: attractor.active,
        status: overridden ? "Overridden" : "Inherited",
        muted: overridden
      };
    });

  return [...projectRows, ...globalRows];
}
