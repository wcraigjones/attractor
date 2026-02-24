const extensionToLanguage: Record<string, string> = {
  ".md": "markdown",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".sh": "shell",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".patch": "diff",
  ".diff": "diff",
  ".toml": "ini"
};

export function monacoLanguageForArtifact(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) {
    return "plaintext";
  }
  const extension = path.slice(dot).toLowerCase();
  return extensionToLanguage[extension] ?? "plaintext";
}
