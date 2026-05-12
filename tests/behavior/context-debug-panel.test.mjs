import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContextDebugPanelView,
  renderContextDebugPanel
} from "../../src/desktop/renderer/console-task-detail.mjs";

function taskWithCompiledContext(extra = {}) {
  return {
    task_id: "task_context_debug",
    conversation_id: "conv_debug",
    project_id: "proj_debug",
    parent_task_id: "task_parent",
    is_continuation: true,
    metadata: {
      branch: {
        kind: "fork",
        source_conversation_id: "conv_source"
      }
    },
    context_packet: {
      file_paths: ["E:\\project\\brief.docx"],
      image_paths: ["E:\\project\\screen.png"],
      selection_metadata: {
        follow_up_resolution: {
          mode: "session_anchor",
          confidence: 0.87,
          parent_task_id: "task_parent",
          should_continue: true
        }
      },
      compiled_context: {
        schema_version: "1.0",
        owner: "service/runtime",
        conversation_id: "conv_debug",
        parent_task_id: "task_parent",
        selected: [
          {
            kind: "follow_up_resolution",
            source: "context_packet.selection_metadata.follow_up_resolution",
            reason: "FollowUpResolver decision determines active context target",
            value: { parent_task_id: "task_parent" }
          },
          {
            kind: "latest_artifact",
            source: "context_packet.recent_conversation_artifacts",
            reason: "recent conversation artifact may be the target of a follow-up",
            value: { artifact_id: "artifact_source_xlsx", kind: "xlsx" }
          },
          {
            kind: "session_compaction",
            source: "conversation_session.session_compactions",
            reason: "deterministic session compaction",
            content: "Session compaction 0-40 with workbook work thread",
            value: {
              session_id: "session_debug",
              compaction_id: "scomp_debug",
              source_item_count: 41
            }
          },
          ...(extra.selected ?? [])
        ],
        omissions: [
          {
            kind: "prior_message",
            source: "context_packet.prior_messages",
            reason: "omitted_by_item_budget"
          }
        ],
        omitted_count: 1,
        stats: {
          candidate_count: 6,
          text_chars: 420
        }
      }
    }
  };
}

test("context debug view exposes session, resolver, artifact, selected, and omitted summaries", () => {
  const view = buildContextDebugPanelView(taskWithCompiledContext());

  assert.equal(view.session.session_id, "session_debug");
  assert.equal(view.session.conversation_id, "conv_debug");
  assert.equal(view.session.project_id, "proj_debug");
  assert.equal(view.session.resolver_mode, "session_anchor");
  assert.equal(view.session.resolver_confidence, 0.87);
  assert.deepEqual(view.action_target.source_artifact_ids, ["artifact_source_xlsx"]);
  assert.equal(view.project_pack.project.packId, "project:proj_debug");
  assert.equal(view.project_pack.attachments.count, 2);
  assert.equal(view.project_pack.conversation.branch.kind, "fork");
  assert.ok(view.selected.some((item) => item.kind === "session_compaction"));
  assert.equal(view.omissions[0].reason, "omitted_by_item_budget");
});

test("context debug panel lazy renders compact rows and keeps full JSON out of the DOM", () => {
  const hugeText = `huge-${"x".repeat(2400)}`;
  const html = renderContextDebugPanel(taskWithCompiledContext({
    selected: [{
      kind: "background_context",
      source: "context_packet.background_contexts",
      reason: "large memory body should be copy-only in full JSON",
      content: hugeText,
      value: { session_id: "session_debug" }
    }]
  }));

  assert.match(html, /data-context-debug-panel="compact"/);
  assert.match(html, /data-context-debug-copy="1"/);
  assert.doesNotMatch(html, /data-context-debug-json/);
  assert.doesNotMatch(html, new RegExp("x{500}"));
  assert.match(html, /latest_artifact/);
  assert.match(html, /Project pack/);
  assert.match(html, /brief\.docx/);
  assert.match(html, /screen\.png/);
  assert.match(html, /omitted_by_item_budget/);
});
