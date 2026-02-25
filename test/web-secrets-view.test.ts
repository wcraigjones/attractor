import { describe, expect, it } from "vitest";

import {
  ARBITRARY_SECRET_PROVIDER,
  buildProjectSecretsViewRows
} from "../apps/factory-web/src/client/lib/secrets-view";
import type { GlobalSecret, ProjectSecret } from "../apps/factory-web/src/client/lib/types";

function projectSecret(input: {
  id: string;
  provider: string;
  keyMappings: Record<string, string>;
}): ProjectSecret {
  return {
    id: input.id,
    projectId: "proj-1",
    name: `project-${input.id}`,
    provider: input.provider,
    k8sSecretName: `project-k8s-${input.id}`,
    keyMappings: input.keyMappings,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function globalSecret(input: {
  id: string;
  provider: string;
  keyMappings: Record<string, string>;
}): GlobalSecret {
  return {
    id: input.id,
    name: `global-${input.id}`,
    provider: input.provider,
    k8sSecretName: `global-k8s-${input.id}`,
    keyMappings: input.keyMappings,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("project secrets view rows", () => {
  it("keeps global row inherited when provider matches but logical keys do not overlap", () => {
    const rows = buildProjectSecretsViewRows(
      [projectSecret({ id: "1", provider: "openai", keyMappings: { orgId: "openai_org" } })],
      [globalSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key" } })]
    );

    const globalRow = rows.find((row) => row.id === "global:1");
    expect(globalRow?.status).toBe("Inherited");
    expect(globalRow?.muted).toBe(false);
  });

  it("marks global row overridden when project covers all global logical keys", () => {
    const rows = buildProjectSecretsViewRows(
      [projectSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key_project" } })],
      [globalSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key" } })]
    );

    const globalRow = rows.find((row) => row.id === "global:1");
    expect(globalRow?.status).toBe("Overridden");
    expect(globalRow?.muted).toBe(true);
  });

  it("marks global row partially overridden when only some logical keys overlap", () => {
    const rows = buildProjectSecretsViewRows(
      [projectSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key_project" } })],
      [globalSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key", orgId: "openai_org" } })]
    );

    const globalRow = rows.find((row) => row.id === "global:1");
    expect(globalRow?.status).toBe("Partially Overridden");
    expect(globalRow?.muted).toBe(true);
  });

  it("does not override globals across different providers", () => {
    const rows = buildProjectSecretsViewRows(
      [projectSecret({ id: "1", provider: "anthropic", keyMappings: { apiKey: "anthropic_api_key" } })],
      [globalSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key" } })]
    );

    const globalRow = rows.find((row) => row.id === "global:1");
    expect(globalRow?.status).toBe("Inherited");
    expect(globalRow?.muted).toBe(false);
  });

  it("always marks project rows as active project source", () => {
    const rows = buildProjectSecretsViewRows(
      [projectSecret({ id: "1", provider: "openai", keyMappings: { apiKey: "openai_api_key" } })],
      []
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "project:1",
      source: "project",
      status: "Project",
      muted: false
    });
  });

  it("only compares arbitrary secrets by matching secret name", () => {
    const rows = buildProjectSecretsViewRows(
      [
        {
          ...projectSecret({ id: "1", provider: ARBITRARY_SECRET_PROVIDER, keyMappings: { token: "token" } }),
          name: "global-1"
        }
      ],
      [
        globalSecret({ id: "1", provider: ARBITRARY_SECRET_PROVIDER, keyMappings: { token: "token" } }),
        globalSecret({ id: "2", provider: ARBITRARY_SECRET_PROVIDER, keyMappings: { token: "token" } })
      ]
    );

    const sameNameGlobal = rows.find((row) => row.id === "global:1");
    const differentNameGlobal = rows.find((row) => row.id === "global:2");

    expect(sameNameGlobal?.status).toBe("Overridden");
    expect(differentNameGlobal?.status).toBe("Inherited");
  });
});
