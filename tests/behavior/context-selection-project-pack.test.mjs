import test from "node:test";
import assert from "node:assert/strict";

import { buildContextSelectionProjectPack } from "../../src/shared/context-selection-project-pack.mjs";

test("context selection project pack summarizes project scope attachments and provenance", () => {
  const pack = buildContextSelectionProjectPack({
    task_id: "task_ctx_pack",
    conversation_id: "conv_ctx",
    project_id: "project_alpha",
    parent_task_id: "task_parent",
    metadata: {
      branch: {
        kind: "edit",
        source_conversation_id: "conv_source",
        source_message_id: "msg_source"
      }
    },
    context_packet: {
      file_paths: ["E:\\work\\brief.docx"],
      image_paths: ["E:\\work\\screen.png"],
      selection_metadata: {
        memory_scope: "project"
      },
      compiled_context: {
        selected: [{
          kind: "attached_file",
          source: "context_packet.file_paths",
          reason: "explicit user attachment",
          value: { path: "E:\\work\\brief.docx" }
        }, {
          kind: "prior_message",
          source: "conversation.messages",
          reason: "recent conversation turn",
          value: { message_id: "msg_recent" }
        }],
        omissions: [{
          kind: "background_context",
          source: "memory",
          reason: "omitted_by_budget"
        }],
        omitted_count: 1,
        stats: { candidate_count: 3 }
      }
    }
  });

  assert.equal(pack.project.projectId, "project_alpha");
  assert.equal(pack.project.packId, "project:project_alpha");
  assert.equal(pack.project.memoryScope, "project");
  assert.equal(pack.attachments.count, 2);
  assert.equal(pack.attachments.files[0].label, "brief.docx");
  assert.equal(pack.attachments.images[0].label, "screen.png");
  assert.equal(pack.conversation.branch.kind, "edit");
  assert.equal(pack.conversation.branch.sourceConversationId, "conv_source");
  assert.equal(pack.context.selectedKinds.attached_file, 1);
  assert.equal(pack.context.omittedKinds.background_context, 1);
  assert.equal(pack.context.selected[1].provenance.messageId, "msg_recent");
});
