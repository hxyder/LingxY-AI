import test from "node:test";
import assert from "node:assert/strict";

import {
  formatToolArgsPreview,
  formatToolDisplayName
} from "../../src/desktop/renderer/tool-display.mjs";
import {
  formatTaskEventSummary
} from "../../src/desktop/renderer/task-event-stream.js";
import {
  renderTimelineEntry
} from "../../src/desktop/renderer/console-task-timeline.mjs";
import {
  buildCapabilityToolView,
  renderCapabilityToolViewHtml
} from "../../src/desktop/renderer/capability-tool-view.mjs";
import {
  renderEvidenceSourcesHtml
} from "../../src/desktop/renderer/evidence-sources-view.mjs";

test("renderer tool display names hide implementation ids for local file tools", () => {
  assert.equal(formatToolDisplayName("read_file_text"), "读取文件原文");
  assert.equal(formatToolDisplayName("read_folder_text"), "读取文件夹原文");
  assert.equal(formatToolDisplayName("search_file_content"), "检索文件索引");
  assert.equal(formatToolArgsPreview("read_file_text", { path: "E:/linxi/docs/resume.md" }), "E:/linxi/docs/resume.md");
});

test("renderer tool display names capability tools and keeps timeline args compact", () => {
  assert.equal(formatToolDisplayName("draft_capability"), "起草能力");
  assert.equal(formatToolDisplayName("save_capability_draft"), "保存能力草稿");
  assert.equal(
    formatToolArgsPreview("draft_capability", { kind: "skill", name: "Inbox Helper" }),
    "skill · Inbox Helper"
  );

  const html = renderTimelineEntry({
    event: "tool_call_proposed",
    ts: "2026-05-04T00:00:00.000Z",
    data: {
      tool_id: "save_capability_draft",
      args: {
        draft: {
          kind: "skill",
          name: "Inbox Helper",
          entry: { markdown: "# Inbox Helper\n\ndescription: very long markdown should not be dumped raw" }
        }
      }
    }
  });
  assert.match(html, /skill · Inbox Helper/);
  assert.doesNotMatch(html, /very long markdown should not be dumped raw/);
});

test("task event summaries render user-facing tool labels and local-read guidance", () => {
  const toolSummary = formatTaskEventSummary({
    event: "tool_call_completed",
    data: { tool_id: "search_file_content", success: true }
  });
  assert.equal(toolSummary.title, "工具完成");
  assert.equal(toolSummary.body, "检索文件索引 · 成功");

  const guidanceSummary = formatTaskEventSummary({
    event: "local_file_read_guidance",
    data: { candidate_count: 2, guidance_count: 1, deep: true }
  });
  assert.equal(guidanceSummary.title, "需要读取原文");
  assert.match(guidanceSummary.body, /深度文件夹读取/);
  assert.match(guidanceSummary.body, /候选 2 个/);
});

test("capability tool view renders interview progress without leaking draft internals", () => {
  const view = buildCapabilityToolView("draft_capability", {
    status: "ready_to_save",
    draft: {
      kind: "skill",
      id: "inbox-helper",
      name: "Inbox Helper",
      purpose: "Triage incoming messages",
      permissions: {
        network: true,
        filesystem: "read",
        secrets: [{ name: "MAIL_TOKEN", value: "must-not-leak" }]
      },
      entry: {
        markdown: "# Inbox Helper\n\n- huge prompt text should not render"
      }
    }
  });
  const html = renderCapabilityToolViewHtml(view);
  assert.match(html, /能力草案已就绪/);
  assert.match(html, /Inbox Helper/);
  assert.match(html, /secrets: 1/);
  assert.doesNotMatch(html, /must-not-leak|huge prompt text/);
});

test("timeline entry shows capability recovery card from metadata", () => {
  const html = renderTimelineEntry({
    event: "tool_call_completed",
    ts: "2026-05-04T00:00:00.000Z",
    data: {
      tool_id: "draft_capability",
      success: true,
      observation: "Draft is ready",
      metadata: {
        status: "interviewing",
        state: { kind: "mcp" },
        missing_fields: ["config"],
        next_question: {
          prompt: "What command should start this MCP server?",
          hint: "Use a command and args, not a secret literal."
        }
      }
    }
  });
  assert.match(html, /能力访谈/);
  assert.match(html, /What command should start this MCP server/);
  assert.doesNotMatch(html, /tool_id/);
});

test("evidence source renderer surfaces fresh, deep, indexed, and shallow file coverage", () => {
  const html = renderEvidenceSourcesHtml({
    source_count: 0,
    distinct_domain_count: 0,
    local_source_count: 1,
    local_sources: ["E:/linxi/docs/resume.md"],
    local_deep_text_source_count: 1,
    local_coverage_scope_counts: { folder_recursive_text: 1 },
    indexed_file_source_count: 1,
    indexed_file_sources: ["E:/linxi/docs/brief.md"],
    indexed_file_coverage_scope_counts: { single_file_text: 1 },
    local_shallow_source_count: 1,
    local_shallow_sources: ["E:/linxi/docs"],
    blended_source_count: 2
  });

  assert.match(html, /deep local read/);
  assert.match(html, /deep folder text/);
  assert.match(html, /indexed fresh file text/);
  assert.match(html, />listed</);
  assert.match(html, /data-evidence-path/);
});
