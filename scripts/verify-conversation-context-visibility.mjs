import assert from "node:assert/strict";

import {
  buildConversationMessageContextSummary,
  conversationContextChips,
  conversationContextPreviewText
} from "../src/shared/conversation-message-context.mjs";
import { renderConversationDetailView } from "../src/desktop/renderer/console-conversation-viewer.mjs";
import { backfillConversationMessageContextSummaries } from "../src/service/core/http-routes/note-project-conversation-routes.mjs";

const contextPacket = {
  source_type: "file_group",
  source_app: "explorer.exe",
  capture_mode: "shell_menu",
  title: "Analyst jobs",
  url: "https://www.linkedin.com/jobs/search/?keywords=analyst",
  text: "Oracle Functional Analyst, Operations Planner, Compensation Analyst, Principal Support Analyst",
  file_paths: [
    "E:\\linxiDoc\\resume.docx",
    "E:\\linxiDoc\\jobs.csv"
  ],
  image_paths: [
    "E:\\linxiDoc\\linkedin-screenshot.png"
  ]
};

const summary = buildConversationMessageContextSummary(contextPacket);
assert.equal(summary.source_type, "file_group");
assert.equal(summary.file_count, 2);
assert.equal(summary.image_count, 1);
assert.match(summary.text_preview, /Oracle Functional Analyst/);

const chips = conversationContextChips(summary);
assert.ok(chips.some((chip) => chip.label === "resume.docx"));
assert.ok(chips.some((chip) => chip.label === "resume.docx" && chip.kind === "file" && chip.path === "E:\\linxiDoc\\resume.docx"));
assert.ok(chips.some((chip) => chip.label === "linkedin-screenshot.png" && chip.kind === "image" && chip.path === "E:\\linxiDoc\\linkedin-screenshot.png"));
assert.ok(chips.some((chip) => chip.label === "linkedin.com"));
assert.ok(chips.some((chip) => chip.label === "linkedin.com" && chip.kind === "url" && chip.url === contextPacket.url));
assert.match(conversationContextPreviewText(summary), /Compensation Analyst/);

const view = renderConversationDetailView({
  conversation: {
    conversation_id: "conv_context",
    title: "Analyst links",
    message_count: 1,
    task_count: 1,
    updated_at: "2026-05-08T12:00:00.000Z"
  },
  messages: [
    {
      message_id: "msg_1",
      conversation_id: "conv_context",
      seq: 0,
      role: "user",
      content: "今天有没有值得看的 analyst 工作？",
      ts: "2026-05-08T12:00:00.000Z",
      status: "ok",
      metadata: { context_summary: summary }
    }
  ],
  message_task_links: []
});

assert.match(view.bodyHtml, /Context/);
assert.match(view.bodyHtml, /resume\.docx/);
assert.match(view.bodyHtml, /linkedin\.com/);
assert.match(view.bodyHtml, /Oracle Functional Analyst/);

const legacyMessages = [
  {
    message_id: "legacy_msg",
    conversation_id: "conv_context",
    seq: 0,
    role: "user",
    content: "解释我选中的文件",
    ts: "2026-05-08T12:00:00.000Z",
    status: "ok",
    metadata: {}
  }
];
const backfilled = backfillConversationMessageContextSummaries(
  legacyMessages,
  [{ message_id: "legacy_msg", task_id: "task_context", relation: "prompted" }],
  {
    getTask(id) {
      assert.equal(id, "task_context");
      return { context_packet: contextPacket };
    }
  }
);
assert.equal(backfilled[0].metadata.context_summary_backfilled, true);
assert.equal(backfilled[0].metadata.context_summary.file_count, 2);

console.log("conversation context visibility ok");
