import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import {
  appendTaskOutcomeMessage,
  ensureConversation
} from "../../src/service/core/task-runtime/conversation-lifecycle.mjs";
import {
  extractEvidenceSummaryFromMessage
} from "../../src/desktop/renderer/evidence-sources-view.mjs";

test("task outcome messages persist evidence summaries for conversation reload", () => {
  const runtime = { store: createInMemoryStoreScaffold() };
  ensureConversation(runtime, { conversationId: "conv_evidence_rehydrate" });
  const evidenceSummary = {
    source_count: 1,
    distinct_domain_count: 1,
    sources: [
      {
        id: "w_abcdef01",
        kind: "web",
        locator: "https://example.com/report",
        title: "Report"
      }
    ],
    citations: { claimed: ["w_abcdef01"], missing: [], unused: [], claim_density: 1 }
  };

  const message = appendTaskOutcomeMessage(runtime, {
    task_id: "task_evidence_rehydrate",
    conversation_id: "conv_evidence_rehydrate",
    executor: "tool_using",
    status: "success",
    result_summary: "Grounded answer [w_abcdef01].",
    evidence_summary: evidenceSummary
  });

  assert.equal(message.metadata.evidence_summary.sources[0].id, "w_abcdef01");
  const [reloaded] = runtime.store.getConversationMessages("conv_evidence_rehydrate");
  assert.equal(reloaded.metadata.evidence_summary.sources[0].locator, "https://example.com/report");
  assert.deepEqual(extractEvidenceSummaryFromMessage(reloaded), evidenceSummary);
});
