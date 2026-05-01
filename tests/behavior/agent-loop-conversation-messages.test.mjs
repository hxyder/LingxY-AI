import test from "node:test";
import assert from "node:assert/strict";

import { buildConversationMessages } from "../../src/service/executors/tool_using/conversation-messages.mjs";

test("agent conversation messages inject tool calls, observations, metadata, artifacts, and failures", () => {
  const messages = buildConversationMessages(
    [{ role: "user", content: "send the attached file" }],
    [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        args: { query: "example" },
        success: true,
        observation: "Found result.",
        metadata: { results: [{ url: "https://example.com" }] },
        artifact_paths: ["E:/linxi/out/report.docx"]
      },
      {
        type: "tool_result",
        tool: "account_upload_file",
        args: { path: "E:/linxi/out/report.docx" },
        success: false,
        observation: "Upload failed."
      }
    ],
    ["E:/linxi/input/resume.pdf"]
  );

  assert.equal(messages[0].content, "send the attached file");
  assert.deepEqual(JSON.parse(messages[1].content), {
    tool: "web_search_fetch",
    args: { query: "example" }
  });
  assert.match(messages[2].content, /\[Tool observation: web_search_fetch\]/);
  assert.match(messages[2].content, /\[Tool metadata JSON\]/);
  assert.match(messages[2].content, /E:\/linxi\/input\/resume\.pdf/);
  assert.match(messages[2].content, /E:\/linxi\/out\/report\.docx/);
  assert.deepEqual(JSON.parse(messages[3].content), {
    tool: "account_upload_file",
    args: { path: "E:/linxi/out/report.docx" }
  });
  assert.match(messages[4].content, /This tool call FAILED/);
  assert.match(messages[4].content, /Do NOT claim success/);
  assert.match(messages[4].content, /E:\/linxi\/out\/report\.docx/);
});

test("agent conversation messages render guidance and retry transcript entries", () => {
  const messages = buildConversationMessages(
    [{ role: "user", content: "complete the task" }],
    [
      { type: "tool_denied", tool: "open_file", reason: "not allowed" },
      { type: "validation_error", tool: "send_email", error: "missing recipient" },
      { type: "prose_trap_retry", assistantProse: "I will do it.", retryHint: "Call a tool." },
      { type: "runbook_guidance", runbook_id: "recover_search", instruction: "Try another source." },
      { type: "contract_guidance", groups: ["email_send"], instruction: "Send the email now." },
      { type: "saturation_hint", repeated_domains: ["example.com", "example.org"], window_size: 4 },
      {
        type: "synthesis_retry",
        assistantDraft: "Raw draft",
        violations: [{ kind: "missing_summary", message: "No summary." }]
      }
    ]
  );

  assert.deepEqual(JSON.parse(messages[1].content), { tool: "open_file", args: {} });
  assert.match(messages[2].content, /\[Tool denied: open_file\] Reason: not allowed/);
  assert.match(messages[3].content, /\[Validation error for send_email\]: missing recipient/);
  assert.equal(messages[4].content, "I will do it.");
  assert.equal(messages[5].content, "Call a tool.");
  assert.match(messages[6].content, /\[Runbook recovery: recover_search\]/);
  assert.match(messages[7].content, /\[Required action handoff: email_send\]/);
  assert.match(messages[8].content, /last 4 web fetches/);
  assert.match(messages[8].content, /example\.com, example\.org/);
  assert.equal(messages[9].content, "Raw draft");
  assert.match(messages[10].content, /\[Synthesis required\]/);
  assert.match(messages[10].content, /missing_summary: No summary/);
});
