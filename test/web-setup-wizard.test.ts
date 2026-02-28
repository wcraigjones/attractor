import { describe, expect, it } from "vitest";

import {
  SETUP_WIZARD_DRAFT_TTL_MS,
  SETUP_WIZARD_STORAGE_KEY,
  clearSetupWizardProjectDraft,
  deriveSetupWizardReadiness,
  firstIncompleteRequiredStep,
  readSetupWizardDraft,
  saveSetupWizardProjectDraft
} from "../apps/factory-web/src/client/lib/setup-wizard";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("setup wizard helpers", () => {
  it("derives completion readiness for project setup", () => {
    const readiness = deriveSetupWizardReadiness({
      projectId: "proj-1",
      projectSecretProviders: ["openai"],
      globalSecretProviders: [],
      attractors: [{ active: true, contentPath: "attractors/proj-1/v1.dot" }],
      runCount: 1
    });

    expect(readiness).toEqual({
      projectComplete: true,
      secretsComplete: true,
      attractorComplete: true,
      runComplete: true,
      allRequiredComplete: true
    });
  });

  it("requires provider-mapped secrets and storage-backed active attractors", () => {
    const readiness = deriveSetupWizardReadiness({
      projectId: "proj-1",
      projectSecretProviders: ["__arbitrary__"],
      globalSecretProviders: [],
      attractors: [
        { active: false, contentPath: "attractors/proj-1/v1.dot" },
        { active: true, contentPath: null }
      ],
      runCount: 0
    });

    expect(readiness.projectComplete).toBe(true);
    expect(readiness.secretsComplete).toBe(false);
    expect(readiness.attractorComplete).toBe(false);
    expect(readiness.runComplete).toBe(false);
    expect(readiness.allRequiredComplete).toBe(false);
  });

  it("resolves the first incomplete required step in order", () => {
    expect(
      firstIncompleteRequiredStep({
        projectComplete: false,
        secretsComplete: false,
        attractorComplete: false,
        runComplete: false,
        allRequiredComplete: false
      })
    ).toBe("project");

    expect(
      firstIncompleteRequiredStep({
        projectComplete: true,
        secretsComplete: false,
        attractorComplete: false,
        runComplete: false,
        allRequiredComplete: false
      })
    ).toBe("secrets");

    expect(
      firstIncompleteRequiredStep({
        projectComplete: true,
        secretsComplete: true,
        attractorComplete: false,
        runComplete: false,
        allRequiredComplete: false
      })
    ).toBe("attractor");

    expect(
      firstIncompleteRequiredStep({
        projectComplete: true,
        secretsComplete: true,
        attractorComplete: true,
        runComplete: false,
        allRequiredComplete: false
      })
    ).toBe("run");

    expect(
      firstIncompleteRequiredStep({
        projectComplete: true,
        secretsComplete: true,
        attractorComplete: true,
        runComplete: true,
        allRequiredComplete: true
      })
    ).toBe("done");
  });

  it("sanitizes project drafts and never persists secret values", () => {
    const storage = new MemoryStorage();

    saveSetupWizardProjectDraft(
      "proj-1",
      {
        secrets: {
          provider: "openai",
          name: "llm-openai",
          logicalKey: "apiKey",
          secretKey: "openai_api_key"
        }
      },
      { storage }
    );

    saveSetupWizardProjectDraft(
      "proj-2",
      {
        secrets: {
          provider: "openai",
          name: "llm-openai",
          logicalKey: "apiKey",
          secretKey: "openai_api_key",
          secretValue: "SHOULD_NOT_BE_STORED"
        } as unknown as {
          provider: string;
          name: string;
          logicalKey: string;
          secretKey: string;
        }
      },
      { storage }
    );

    const raw = storage.getItem(SETUP_WIZARD_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("SHOULD_NOT_BE_STORED");

    const draft = readSetupWizardDraft({ storage });
    expect(draft.projects["proj-2"]?.secrets).toEqual({
      provider: "openai",
      name: "llm-openai",
      logicalKey: "apiKey",
      secretKey: "openai_api_key"
    });

    clearSetupWizardProjectDraft("proj-2", { storage });
    const cleared = readSetupWizardDraft({ storage });
    expect(cleared.projects["proj-2"]).toBeUndefined();
  });

  it("expires stale drafts older than seven days", () => {
    const storage = new MemoryStorage();
    const now = 1_000_000;

    storage.setItem(
      SETUP_WIZARD_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entry: {
          data: {
            selectedProjectId: "proj-old"
          },
          updatedAtMs: now - SETUP_WIZARD_DRAFT_TTL_MS - 1
        },
        projects: {
          "proj-old": {
            data: {
              lastStep: "run"
            },
            updatedAtMs: now - SETUP_WIZARD_DRAFT_TTL_MS - 1
          }
        }
      })
    );

    const draft = readSetupWizardDraft({ storage, nowMs: now });
    expect(draft).toEqual({ entry: {}, projects: {} });

    const persisted = storage.getItem(SETUP_WIZARD_STORAGE_KEY);
    expect(persisted).toBeNull();
  });
});
