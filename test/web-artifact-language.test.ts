import { describe, expect, it } from "vitest";

import { monacoLanguageForArtifact } from "../apps/factory-web/src/client/lib/artifact-language";

describe("monaco language mapping", () => {
  it("maps known extensions", () => {
    expect(monacoLanguageForArtifact("plan.md")).toBe("markdown");
    expect(monacoLanguageForArtifact("tasks.json")).toBe("json");
    expect(monacoLanguageForArtifact("implementation.patch")).toBe("diff");
  });

  it("falls back to plaintext for unknown extensions", () => {
    expect(monacoLanguageForArtifact("artifact.unknownext")).toBe("plaintext");
    expect(monacoLanguageForArtifact("artifact")).toBe("plaintext");
  });
});
