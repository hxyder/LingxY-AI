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
  renderEvidenceSourcesHtml
} from "../../src/desktop/renderer/evidence-sources-view.mjs";

test("renderer tool display names hide implementation ids for local file tools", () => {
  assert.equal(formatToolDisplayName("read_file_text"), "读取文件原文");
  assert.equal(formatToolDisplayName("read_folder_text"), "读取文件夹原文");
  assert.equal(formatToolDisplayName("search_file_content"), "检索文件索引");
  assert.equal(formatToolArgsPreview("read_file_text", { path: "E:/linxi/docs/resume.md" }), "E:/linxi/docs/resume.md");
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
