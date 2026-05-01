import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTranscriptForComposer,
  finalFallbackText,
  hasUnresolvedActionFailure,
  localFallbackFinal,
  needsFinalComposer
} from "../../src/service/executors/tool_using/finalization.mjs";

test("agent finalization formats launch disambiguation without internal protocol fields", () => {
  const text = finalFallbackText([
    {
      type: "tool_result",
      tool: "launch_app",
      success: false,
      args: { app: "Alpha" },
      observation: "multiple candidates",
      metadata: {
        disambiguation_required: true,
        disambiguation_type: "launch_app_candidate",
        target_app: "Alpha",
        candidates: [
          {
            display_name: "Alpha Desktop",
            exe_path: "C:\\Apps\\Alpha\\alpha.exe",
            is_dev_tool: false
          },
          {
            display_name: "Alpha Tools",
            exe_path: "C:\\Apps\\AlphaTools\\alpha-tools.exe",
            is_dev_tool: true
          }
        ]
      }
    }
  ], "打开 Alpha", { synthesis: { expected_output: "execution" } });

  assert.match(text, /请选择要打开哪一个/);
  assert.match(text, /Alpha Desktop/);
  assert.match(text, /Alpha Tools/);
  assert.ok(!/launch_args/.test(text));
});

test("agent finalization separates connector raw results from synthesis-needed replies", () => {
  const transcript = [
    {
      type: "tool_result",
      tool: "account_list_emails",
      success: true,
      observation: "raw emails",
      metadata: {
        account: { provider: "google", accountId: "me@example.com" },
        emails: [
          { received: "2026-01-01", from: "a@example.com", subject: "Hello" }
        ]
      }
    }
  ];

  const raw = finalFallbackText(
    transcript,
    "列出邮件",
    { synthesis: { expected_output: "raw_results" } }
  );
  const summary = finalFallbackText(
    transcript,
    "总结邮件",
    { synthesis: { expected_output: "summary" } }
  );

  assert.match(raw, /1 封邮件|1 emails/);
  assert.match(raw, /Hello/);
  assert.match(summary, /仍需要按你的请求进行总结|still needs synthesis/);
});

test("agent finalization decides when a final composer is needed", () => {
  assert.equal(needsFinalComposer({
    task_spec: { goal: "qa", synthesis: { expected_output: "summary" } }
  }, [
    { type: "tool_result", tool: "lookup_fixture", success: true, observation: "facts" }
  ]), true);

  assert.equal(needsFinalComposer({
    task_spec: { goal: "launch_and_act", synthesis: { expected_output: "execution" } }
  }, [
    { type: "tool_result", tool: "launch_app", success: true, observation: "Launched Alpha" }
  ]), false);

  assert.equal(needsFinalComposer({
    task_spec: { goal: "qa", synthesis: { expected_output: "raw_results" } }
  }, [
    { type: "tool_result", tool: "account_list_files", success: true, observation: "files" }
  ]), false);
});

test("agent finalization tracks unresolved action failures by latest action status", () => {
  const failedOnly = [
    { type: "tool_result", tool: "open_url", args: { url: "https://a.test" }, success: false, observation: "blocked" }
  ];
  const laterSucceeded = [
    ...failedOnly,
    { type: "tool_result", tool: "open_url", args: { url: "https://a.test" }, success: true, observation: "opened" }
  ];

  assert.equal(hasUnresolvedActionFailure(failedOnly), true);
  assert.equal(hasUnresolvedActionFailure(laterSucceeded), false);
});

test("agent finalization compacts transcript for final composer", () => {
  const text = compactTranscriptForComposer([
    {
      type: "tool_result",
      tool: "lookup_fixture",
      args: { value: "alpha" },
      success: true,
      observation: "Observed alpha\nwith whitespace",
      metadata: { source: "test" }
    },
    { type: "tool_denied", tool: "open_file", reason: "tool_not_available_for_task" },
    { type: "validation_error", tool: "send_email", error: "missing recipient" }
  ]);

  assert.match(text, /lookup_fixture/);
  assert.match(text, /Observed alpha with whitespace/);
  assert.match(text, /metadata=.*source/);
  assert.match(text, /open_file denied/);
  assert.match(text, /send_email validation_error/);
});

test("agent finalization local fallback uses latest tool observation", () => {
  const text = localFallbackFinal({
    task: { user_command: "总结一下" },
    transcript: [
      { type: "tool_result", tool: "lookup_fixture", success: true, observation: "可用信息：Alpha Beta Gamma" }
    ],
    reason: "composer_error"
  });

  assert.match(text, /工具返回的信息|Alpha Beta Gamma/);
});
