import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const forbiddenImports = [
  "@anthropic-ai/sdk",
  "@google/genai",
  "@aws-sdk/client-bedrock-runtime",
  "openai"
];

function collectTsFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("runtime dependency boundary", () => {
  it("does not import provider SDKs directly from source modules", () => {
    const sourceFiles = collectTsFiles(join(process.cwd(), "src"));

    const violations: Array<{ file: string; forbiddenImport: string }> = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      for (const forbiddenImport of forbiddenImports) {
        const importPattern = new RegExp(`from\\s+["']${forbiddenImport}["']`, "g");
        if (importPattern.test(source)) {
          violations.push({ file, forbiddenImport });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
