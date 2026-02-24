import { describe, expect, it } from "vitest";

import {
  clampPreviewBytes,
  isProbablyText,
  isTextByMetadata,
  PREVIEW_BYTES_DEFAULT,
  PREVIEW_BYTES_MAX
} from "../apps/factory-api/src/artifact-preview.js";

describe("artifact preview helpers", () => {
  it("clamps preview bytes to defaults and max", () => {
    expect(clampPreviewBytes(undefined)).toBe(PREVIEW_BYTES_DEFAULT);
    expect(clampPreviewBytes("-1")).toBe(PREVIEW_BYTES_DEFAULT);
    expect(clampPreviewBytes(String(PREVIEW_BYTES_MAX + 1024))).toBe(PREVIEW_BYTES_MAX);
    expect(clampPreviewBytes("2048")).toBe(2048);
  });

  it("detects text by metadata and extension", () => {
    expect(isTextByMetadata("text/plain", "note.bin")).toBe(true);
    expect(isTextByMetadata("application/octet-stream", "blob.dat")).toBe(false);
    expect(isTextByMetadata(undefined, "requirements.md")).toBe(true);
  });

  it("detects likely text vs binary bytes", () => {
    expect(isProbablyText(Buffer.from("hello world\n", "utf8"))).toBe(true);
    expect(isProbablyText(Buffer.from([0xff, 0x00, 0x31, 0x00]))).toBe(false);
  });
});
