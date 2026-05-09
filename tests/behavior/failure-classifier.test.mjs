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

test("provider auth failures include provider-specific recovery copy", () => {
  const out = classifyFailure({
    provider_id: "openai",
    model: "gpt-5.4",
    message: "OpenAI API returned 401 invalid API key"
  });
  assert.equal(out.category, "permission_denied");
  assert.equal(out.retryable, false);
  assert.match(out.userMessage, /OpenAI 鉴权/);
  assert.equal(out.recoveryPolicy.provider, "openai");
  assert.equal(out.recoveryPolicy.issue, "auth");
  assert.ok(out.userActions.includes("检查 API Key/环境变量"));
});

test("tool failures include tool-specific recovery copy", () => {
  const out = classifyFailure({
    tool_id: "generate_document",
    message: "generate_document failed: ENOSPC disk full while writing docx"
  });
  assert.equal(out.category, "output_save_error");
  assert.equal(out.recoveryPolicy.tool_id, "generate_document");
  assert.equal(out.recoveryPolicy.issue, "disk");
  assert.match(out.userMessage, /文件生成失败/);
  assert.ok(out.userActions.includes("释放磁盘空间"));
});
