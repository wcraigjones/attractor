import { extname } from "node:path";

export const PREVIEW_BYTES_DEFAULT = 1024 * 1024;
export const PREVIEW_BYTES_MAX = 5 * 1024 * 1024;

const TEXT_CONTENT_HINTS = [
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-httpd-php",
  "application/x-diff",
  "application/x-patch"
];

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".html",
  ".css",
  ".scss",
  ".sql",
  ".xml",
  ".csv",
  ".patch",
  ".diff",
  ".sh",
  ".env",
  ".toml",
  ".ini"
]);

export function clampPreviewBytes(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return PREVIEW_BYTES_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PREVIEW_BYTES_DEFAULT;
  }
  return Math.min(parsed, PREVIEW_BYTES_MAX);
}

export function isTextByMetadata(contentType: string | null | undefined, key: string): boolean {
  if (contentType) {
    const normalized = contentType.toLowerCase();
    if (normalized.startsWith("text/")) {
      return true;
    }
    if (TEXT_CONTENT_HINTS.some((hint) => normalized.includes(hint))) {
      return true;
    }
    if (
      normalized.startsWith("image/") ||
      normalized.startsWith("audio/") ||
      normalized.startsWith("video/") ||
      normalized.includes("application/pdf") ||
      normalized.includes("application/zip") ||
      normalized.includes("application/octet-stream")
    ) {
      return false;
    }
  }

  return TEXT_EXTENSIONS.has(extname(key).toLowerCase());
}

export function isProbablyText(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }

  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return false;
    }
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    const isAscii = byte >= 32 && byte <= 126;
    if (!isAllowedControl && !isAscii && byte < 0x80) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length < 0.02;
}
