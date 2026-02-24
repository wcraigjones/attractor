import { describe, expect, it } from "vitest";

import { extractUnifiedDiff } from "../apps/factory-runner/src/patch.ts";

describe("runner patch extraction", () => {
  it("extracts fenced diff blocks", () => {
    const response = [
      "Summary:",
      "- updated health check",
      "",
      "```diff",
      "diff --git a/file.txt b/file.txt",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "```"
    ].join("\n");

    const diff = extractUnifiedDiff(response);
    expect(diff).toContain("diff --git a/file.txt b/file.txt");
    expect(diff?.endsWith("\n")).toBe(true);
  });

  it("extracts inline diff content when no fence exists", () => {
    const response = [
      "Summary first",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts"
    ].join("\n");
    const diff = extractUnifiedDiff(response);
    expect(diff).toBe("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n");
  });

  it("returns null when no diff is present", () => {
    expect(extractUnifiedDiff("No patch here")).toBeNull();
  });
});
