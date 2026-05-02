import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHallucinatedClaimBanner,
  detectUnbackedConnectorClaim
} from "../../src/service/executors/tool_using/truthfulness-guard.mjs";

test("agent truthfulness guard detects connector write claims without tool evidence", () => {
  const violation = detectUnbackedConnectorClaim({
    transcript: [
      { type: "tool_result", tool: "web_search_fetch", success: true, observation: "background info" }
    ],
    final_text: "邮件已成功发送给 ops@example.com。"
  });

  assert.equal(violation?.kind, "email_send_claim_unsupported");
});

test("agent truthfulness guard allows claims backed by successful action tools", () => {
  const violation = detectUnbackedConnectorClaim({
    transcript: [
      { type: "tool_result", tool: "send_email_smtp", success: true, observation: "sent" }
    ],
    final_text: "邮件已成功发送给 ops@example.com。"
  });

  assert.equal(violation, null);
});

test("agent truthfulness guard renders user-visible banners by action group", () => {
  assert.match(
    buildHallucinatedClaimBanner({ kind: "app_launch_claim_unsupported" }),
    /应用\/页面实际并未打开/
  );
  assert.match(
    buildHallucinatedClaimBanner({ kind: "notification_send_claim_unsupported" }),
    /通知实际并未发送/
  );
});
