import test from "node:test";
import assert from "node:assert/strict";

import { classifyFailure } from "../../src/service/failures/classifier.mjs";

test("artifact-required failure is classified as missing_artifact, not parse_error", () => {
  const out = classifyFailure({
    message: "Task requires a pdf artifact, but no artifact was created."
  });
  assert.equal(out.category, "missing_artifact");
  assert.equal(out.retryable, true);
  assert.match(out.userMessage, /需要生成文件/);
});

test("corrupt document parse failures still classify as parse_error", () => {
  const out = classifyFailure({
    message: "Failed to parse PDF: invalid xref table."
  });
  assert.equal(out.category, "parse_error");
  assert.equal(out.retryable, false);
});
