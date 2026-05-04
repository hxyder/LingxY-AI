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

test("agent truthfulness guard treats indexed file hits as locator evidence, not fresh reads", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      {
        type: "tool_result",
        tool: "search_file_content",
        success: true,
        observation: "Found 1 indexed file hit.",
        metadata: {
          results: [
            {
              path: "E:\\docs\\indexed.md",
              coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
            }
          ]
        }
      }
    ],
    final_text: "I have reviewed the document and summarized the file below."
  }, {
    context_packet: {}
  });

  assert.equal(violation?.kind, "local_file_read_claim_unsupported");
  assert.match(buildHallucinatedClaimBanner(violation), /索引命中/);
});

test("agent truthfulness guard allows indexed hits after a fresh file read", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      {
        type: "tool_result",
        tool: "search_file_content",
        success: true,
        observation: "Found indexed file hit.",
        metadata: {
          results: [{ path: "E:\\docs\\indexed.md" }]
        }
      },
      {
        type: "tool_result",
        tool: "read_file_text",
        success: true,
        observation: "Fresh document text",
        metadata: {
          path: "E:\\docs\\indexed.md",
          coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
          content_extracted: true
        }
      }
    ],
    final_text: "I reviewed the document and summarized the file below."
  }, {
    context_packet: {}
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

test("agent truthfulness guard rejects single-file evidence for deep file-read tasks", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      {
        type: "tool_result",
        tool: "read_file_text",
        success: true,
        observation: "One file text",
        metadata: {
          coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
          content_extracted: true
        }
      }
    ],
    final_text: "我已经分析了这个文件夹，下面是总结。"
  }, {
    context_packet: {
      file_paths: ["C:\\Users\\demo\\project"]
    },
    task_spec: {
      file_read: { depth: "deep" }
    }
  });

  assert.equal(violation?.kind, "local_file_deep_read_insufficient");
  assert.match(buildHallucinatedClaimBanner(violation), /文件读取深度不足/);
});

test("agent truthfulness guard allows deep file-read claims after recursive folder text", () => {
  const violation = detectUnbackedLocalFileClaim({
    transcript: [
      {
        type: "tool_result",
        tool: "read_folder_text",
        success: true,
        observation: "Folder text",
        metadata: {
          coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
          content_extracted: true,
          recursive: true
        }
      }
    ],
    final_text: "我已经分析了这个文件夹，下面是总结。"
  }, {
    context_packet: {
      file_paths: ["C:\\Users\\demo\\project"]
    },
    task_spec: {
      file_read: { depth: "deep" }
    }
  });

  assert.equal(violation, null);
});
