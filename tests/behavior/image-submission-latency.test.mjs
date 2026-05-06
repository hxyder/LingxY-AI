import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("image submission creates tasks without blocking on OCR", async () => {
  const source = await readFile(new URL("../../src/service/core/image-submission.mjs", import.meta.url), "utf8");

  assert.equal(source.includes("runImageOcr"), false);
  assert.match(source, /ocrResult:\s*null/);
  assert.match(source, /step:\s*"image_context"/);
  assert.doesNotMatch(source, /await\s+runImageOcr/);
});
