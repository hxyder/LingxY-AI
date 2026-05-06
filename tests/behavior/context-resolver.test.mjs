import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAttachmentSubmission,
  resolveOverlayContextSubmission
} from "../../src/shared/context-resolver.mjs";

test("explicit current-page requests do not fall back to stale seed capture", () => {
  const decision = resolveOverlayContextSubmission({
    explicitBrowserContextRequest: true,
    activeBrowserCapture: null,
    seedCapture: { sourceType: "text_selection", text: "old email" }
  });

  assert.equal(decision.kind, "missing_explicit_browser_context");
  assert.equal(decision.fallbackAllowed, false);
});

test("explicit current-page capture beats pending files and seed capture", () => {
  const decision = resolveOverlayContextSubmission({
    explicitBrowserContextRequest: true,
    activeBrowserCapture: { sourceType: "webpage", url: "https://example.test" },
    pendingFileSelection: { filePaths: ["E:/old.png"] },
    seedCapture: { sourceType: "text_selection", text: "old email" }
  });

  assert.equal(decision.kind, "capture");
  assert.equal(decision.reason, "explicit_browser_context");
  assert.equal(decision.capture.url, "https://example.test");
});

test("pending image files route separately from document files", () => {
  assert.equal(resolveOverlayContextSubmission({
    pendingFileSelection: { filePaths: ["E:/shot.png", "E:/photo.jpg"] }
  }).kind, "image_paths");

  assert.equal(resolveOverlayContextSubmission({
    pendingFileSelection: { filePaths: ["E:/report.pdf", "E:/photo.jpg"] }
  }).kind, "file_paths");
});

test("active current-file image selections use image context, not file ingest", () => {
  const decision = resolveOverlayContextSubmission({
    explicitFileContextRequest: true,
    activeFileSelection: { filePaths: ["E:/Screenshots/current.webp"] }
  });

  assert.equal(decision.kind, "image_paths");
  assert.equal(decision.reason, "explicit_image_context");
  assert.deepEqual(decision.filePaths, ["E:/Screenshots/current.webp"]);
});

test("attachment normalization keeps images out of file ingest when possible", () => {
  assert.deepEqual(normalizeAttachmentSubmission({
    filePaths: ["E:/a.png", "E:/b.jpg"]
  }), {
    imagePaths: ["E:/a.png", "E:/b.jpg"],
    source: "file"
  });

  assert.deepEqual(normalizeAttachmentSubmission({
    filePaths: ["E:/report.pdf"],
    imagePaths: ["E:/figure.png"]
  }), {
    filePaths: ["E:/report.pdf"],
    imagePaths: ["E:/figure.png"],
    source: "file"
  });
});

test("explicit current-file requests do not fall back to stale seed capture", () => {
  const decision = resolveOverlayContextSubmission({
    explicitFileContextRequest: true,
    activeFileSelection: null,
    pendingFileSelection: null,
    seedCapture: { sourceType: "text_selection", text: "old selection" }
  });

  assert.equal(decision.kind, "missing_explicit_file_context");
  assert.equal(decision.fallbackAllowed, false);
});

test("pending capture wins over seed capture for follow-up context", () => {
  const decision = resolveOverlayContextSubmission({
    pendingCapture: { capture: { sourceType: "text_selection", text: "new selection" } },
    seedCapture: { sourceType: "text_selection", text: "old selection" }
  });

  assert.equal(decision.kind, "capture");
  assert.equal(decision.reason, "pending_capture");
  assert.equal(decision.capture.text, "new selection");
});
