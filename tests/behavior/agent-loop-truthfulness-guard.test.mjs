import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHallucinatedClaimBanner,
  detectUnbackedConnectorClaim,
  detectUnbackedLocalFileClaim
} from "../../src/service/executors/tool_using/truthfulness-guard.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";

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

test("agent truthfulness guard detects local-file analysis claims without file text extraction", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      { type: "tool_result", tool: "stat_file", success: true, observation: "File exists" }
    ],
    final_text: "我已经分析了你的简历，整体经验很匹配产品经理岗位。"
  }, {
    context_packet: {
      file_paths: ["C:\\Users\\demo\\resume.pdf"]
    }
  });

  assert.equal(violation?.kind, "local_file_read_claim_unsupported");
  assert.match(buildHallucinatedClaimBanner(violation), /文件内容实际并未读取/);
});

test("agent truthfulness guard allows local-file claims after read_file_text", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      { type: "tool_result", tool: "read_file_text", success: true, observation: "Resume text" }
    ],
    final_text: "我已经分析了你的简历，下面是建议。"
  }, {
    context_packet: {
      file_paths: ["C:\\Users\\demo\\resume.pdf"]
    }
  });

  assert.equal(violation, null);
});

test("agent truthfulness guard rejects shallow file enumeration as content evidence", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      {
        type: "tool_result",
        tool: "read_file_text",
        success: true,
        observation: "Found files",
        metadata: {
          coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW,
          content_extracted: false
        }
      }
    ],
    final_text: "我已经分析了你的文件夹，下面是总结。"
  }, {
    context_packet: {
      file_paths: ["C:\\Users\\demo\\project"]
    }
  });

  assert.equal(violation?.kind, "local_file_read_claim_unsupported");
});
