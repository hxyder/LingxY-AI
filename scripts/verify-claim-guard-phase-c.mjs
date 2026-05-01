// Phase C verifier: claim guard catches hallucinated file_modify /
// app_launch / notification_send claims even when SR did not classify
// them as required obligations.
//
// These three are claim-guard-only (NOT in POLICY_GROUPS / SR enum /
// task-spec filter / obligation evaluator). The reasoning: SR triggers
// for "modify/open/notify" are too ambiguous to enforce as required
// obligations ("可以打开 Word" is a suggestion; "建议修改 README" is
// advice). But the past-tense completion claim form ("已修改 README",
// "I've opened Word") is a clean hallucination signal — if no backing
// tool ran, downgrade.

import assert from "node:assert/strict";

import { detectUnbackedActionClaims } from "../src/service/core/policy/success-contract-validator.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

const success = (tool, extras = {}) => ({
  type: "tool_result",
  tool,
  success: true,
  observation: `${tool} succeeded`,
  metadata: { tool_id: tool },
  ...extras
});

// =====================================================================
// file_modify
// =====================================================================
{
  const v = detectUnbackedActionClaims([], "已修改 README.md：补充了部署步骤。");
  check("file_modify ZH: '已修改 README.md' with empty transcript → flagged",
    v.some((x) => x.kind === "file_modify_claim_unsupported"));
}
{
  const v = detectUnbackedActionClaims([], "I've updated the README to mention the new flag.");
  check("file_modify EN: 'I've updated the README' with empty transcript → flagged",
    v.some((x) => x.kind === "file_modify_claim_unsupported"));
}
{
  const v = detectUnbackedActionClaims(
    [success("edit_file", { observation: "edited README.md" })],
    "已修改 README.md：补充了部署步骤。"
  );
  check("file_modify: successful edit_file satisfies the claim",
    v.length === 0);
}
{
  const v = detectUnbackedActionClaims(
    [success("write_file", { observation: "wrote README.md" })],
    "已修改 README.md。"
  );
  check("file_modify: successful write_file satisfies the claim",
    v.length === 0);
}
{
  const v = detectUnbackedActionClaims([], "我无法修改 README — 缺少写入权限。");
  check("file_modify negation: '无法修改' is recognised as a negation",
    v.length === 0);
}
{
  // Generic prose mentioning "修改" but NOT past-tense completion.
  const v = detectUnbackedActionClaims([], "你可以修改 README 来描述新功能。");
  check("file_modify: prose advice '你可以修改 X' does not trigger",
    v.length === 0);
}

// =====================================================================
// app_launch
// =====================================================================
{
  const v = detectUnbackedActionClaims([], "已打开 Word，请继续编辑文档。");
  check("app_launch ZH: '已打开 Word' with empty transcript → flagged",
    v.some((x) => x.kind === "app_launch_claim_unsupported"));
}
{
  const v = detectUnbackedActionClaims([], "I've opened Word for you.");
  check("app_launch EN: \"I've opened Word\" with empty transcript → flagged",
    v.some((x) => x.kind === "app_launch_claim_unsupported"));
}
{
  const v = detectUnbackedActionClaims(
    [success("launch_app", { observation: "launched Word" })],
    "已打开 Word。"
  );
  check("app_launch: successful launch_app satisfies the claim",
    v.length === 0);
}
{
  const v = detectUnbackedActionClaims([], "我无法打开 Word，应用未安装。");
  check("app_launch negation: '无法打开' is recognised as a negation",
    v.length === 0);
}
{
  // "已打开文件" (opened a file) should NOT trigger app_launch — that's
  // not an app launch.
  const v = detectUnbackedActionClaims([], "已打开文件查看内容。");
  check("app_launch: '已打开文件' does NOT trigger (not an app launch)",
    !v.some((x) => x.kind === "app_launch_claim_unsupported"));
}
{
  // "已启用" is common status prose for schedules/settings and must not
  // be treated as "launched an app".
  const v = detectUnbackedActionClaims([], "存在 1 条已启用的定时任务。");
  check("app_launch: '已启用的定时任务' does NOT trigger",
    !v.some((x) => x.kind === "app_launch_claim_unsupported"));
}

// =====================================================================
// notification_send
// =====================================================================
{
  const v = detectUnbackedActionClaims([], "已发送通知到你的桌面。");
  check("notify ZH: '已发送通知' with empty transcript → flagged",
    v.some((x) => x.kind === "notification_send_claim_unsupported"));
}
{
  const v = detectUnbackedActionClaims([], "I've sent you a notification.");
  check("notify EN: \"I've sent you a notification\" with empty transcript → flagged",
    v.some((x) => x.kind === "notification_send_claim_unsupported"));
}
{
  const v = detectUnbackedActionClaims(
    [success("notify", { observation: "notification displayed" })],
    "已发送通知到你的桌面。"
  );
  check("notify: successful notify satisfies the claim",
    v.length === 0);
}
{
  const v = detectUnbackedActionClaims([], "通知发送失败，请重试。");
  check("notify negation: '发送失败' is recognised as a negation",
    v.length === 0);
}
{
  // "通知" alone in advice form should NOT trigger.
  const v = detectUnbackedActionClaims([], "你可以通过通知中心查看消息。");
  check("notify: prose mentioning 通知 中心 does not trigger (not a past-tense send)",
    v.length === 0);
}

// =====================================================================
// Cross-group: schedule_create's "已设置好提醒" must NOT also fire
// notification_send.
// =====================================================================
{
  const v = detectUnbackedActionClaims([], "已为你设置好每天早上 8 点的提醒。");
  const kinds = v.map((x) => x.kind);
  check("cross-group: 'set reminder' fires schedule_create only",
    kinds.includes("schedule_create_claim_unsupported")
    && !kinds.includes("notification_send_claim_unsupported"));
}

// =====================================================================
// Cross-group: file_modify's '已修改' must NOT fire file_upload.
// =====================================================================
{
  const v = detectUnbackedActionClaims([], "已修改 README.md。");
  const kinds = v.map((x) => x.kind);
  check("cross-group: 'modified file' fires file_modify only",
    kinds.includes("file_modify_claim_unsupported")
    && !kinds.includes("file_upload_claim_unsupported"));
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
