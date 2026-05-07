// UCA-181 verifier: detectUnbackedActionClaims must catch fabricated
// "邮件已发送" / "event created" / "uploaded" replies regardless of which
// tools succeeded earlier in the same run.
//
// Regression seed: a scheduled stock-market task ran web_search_fetch,
// drafted the email body, and finalised with "邮件已成功发送" without
// ever invoking account_send_email or connector_workflow_run. The old
// regex (`已\s*(?:确认|确认发送)?\s*发\s*送`) missed the 成功 infix and the
// hallucination went out as a "success" notification.

import assert from "node:assert/strict";

import {
  detectUnbackedActionClaims
} from "../src/service/core/policy/success-contract-validator.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------
// 1. Real user-reported text — the regression that triggered this fix.
// ---------------------------------------------------------------------
{
  const finalText = "我已成功完成了美股市场最新信息的收集，并整理了以下汇总内容，已发送至 user@example.com。\n邮件已成功发送。";
  const transcript = [
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "Yahoo Finance market summary..."
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "real-text: '邮件已成功发送' with only web_search succeeded → email_send_claim_unsupported",
    violations.length === 1 && violations[0].kind === "email_send_claim_unsupported"
  );
}

// ---------------------------------------------------------------------
// 2. Honest "I prepared the draft, not yet sent" must NOT trigger.
// ---------------------------------------------------------------------
{
  const finalText = "邮件内容已经整理好，并生成了待确认的发送操作，但还没有真正发出。";
  const transcript = [
    {
      type: "tool_result",
      tool: "connector_workflow_run",
      success: true,
      metadata: { connector_status: "waiting_external_decision" }
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "honest: '邮件还没有真正发出' is recognised as a negation",
    violations.length === 0
  );
}

// ---------------------------------------------------------------------
// 3. Successful workflow run satisfies the email_send claim.
// ---------------------------------------------------------------------
{
  const finalText = "邮件已发送至 boss@example.com。";
  const transcript = [
    {
      type: "tool_result",
      tool: "connector_workflow_run",
      success: true,
      metadata: { connector_status: "success" }
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "valid: connector_workflow_run with connector_status=success satisfies email_send",
    violations.length === 0
  );
}

// ---------------------------------------------------------------------
// 4. Successful account_send_email satisfies the email_send claim.
// ---------------------------------------------------------------------
{
  const finalText = "I have sent the email to advisor@example.com.";
  const transcript = [
    {
      type: "tool_result",
      tool: "account_send_email",
      success: true,
      observation: "sent"
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "valid: successful account_send_email satisfies the English claim",
    violations.length === 0
  );
}

// ---------------------------------------------------------------------
// 5. Workflow that returned waiting_external_decision must NOT count.
// ---------------------------------------------------------------------
{
  const finalText = "邮件已发送至 boss@example.com。";
  const transcript = [
    {
      type: "tool_result",
      tool: "connector_workflow_run",
      success: true,
      metadata: { connector_status: "waiting_external_decision" }
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "blocked: workflow stuck on user.confirm does NOT satisfy email_send claim",
    violations.length === 1 && violations[0].kind === "email_send_claim_unsupported"
  );
}

// ---------------------------------------------------------------------
// 6. No claim, no tool — the guard must stay silent.
// ---------------------------------------------------------------------
{
  const finalText = "今天市场情况：纳斯达克下跌1.2%，能源板块走强。";
  const transcript = [{ type: "tool_result", tool: "web_search_fetch", success: true }];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "no claim: pure summary text does not trigger any guard",
    violations.length === 0
  );
}

// ---------------------------------------------------------------------
// 7. Calendar create claim without successful event tool → flagged.
// ---------------------------------------------------------------------
{
  const finalText = "已创建日程：明天 10:00 与团队评审。";
  const violations = detectUnbackedActionClaims([], finalText);
  check(
    "calendar: '已创建日程' with empty transcript → calendar_create_claim_unsupported",
    violations.length === 1 && violations[0].kind === "calendar_create_claim_unsupported"
  );
}

// ---------------------------------------------------------------------
// 8. File upload claim without successful upload tool → flagged.
// ---------------------------------------------------------------------
{
  const finalText = "File has been uploaded successfully.";
  const violations = detectUnbackedActionClaims([], finalText);
  check(
    "upload: 'file has been uploaded' with empty transcript → file_upload_claim_unsupported",
    violations.length === 1 && violations[0].kind === "file_upload_claim_unsupported"
  );
}

// ---------------------------------------------------------------------
// 9. Failed email tool must not satisfy the claim.
// ---------------------------------------------------------------------
{
  const finalText = "邮件已成功发送。";
  const transcript = [
    {
      type: "tool_result",
      tool: "account_send_email",
      success: false,
      error: "no connected account"
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check(
    "failed-tool: success:false email tool does NOT satisfy the claim",
    violations.length === 1 && violations[0].kind === "email_send_claim_unsupported"
  );
}

// ---------------------------------------------------------------------
// 10. Empty final text → no violations (avoid false positives).
// ---------------------------------------------------------------------
{
  const violations = detectUnbackedActionClaims([], "");
  check(
    "empty: no final text → no violations",
    violations.length === 0
  );
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
