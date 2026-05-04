import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

import {
  extractEvidenceSummaryFromMessage,
  renderEvidenceSourcesHtml,
  revealEvidenceSource
} from "../../src/desktop/renderer/evidence-sources-view.mjs";
import {
  renderChatMessageBlocksHtml
} from "../../src/desktop/renderer/chat-blocks.mjs";

test("reloaded assistant messages can rebuild evidence rows for citation reveal", () => {
  const message = {
    role: "assistant",
    content: "Grounded answer [w_abcdef01].",
    metadata: {
      task_id: "task_reloaded",
      evidence_summary: {
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
      }
    }
  };
  const evidence = extractEvidenceSummaryFromMessage(message);
  const { document } = parseHTML(`
    <main>
      <article>${renderChatMessageBlocksHtml(message.content)}</article>
      ${renderEvidenceSourcesHtml(evidence)}
    </main>
  `);
  const row = document.querySelector("[data-evidence-source-row][data-source-id='w_abcdef01']");
  assert.ok(row, "message metadata should rehydrate the evidence row");
  let scrolled = false;
  row.scrollIntoView = () => { scrolled = true; };

  assert.equal(revealEvidenceSource(document, "w_abcdef01", { flashMs: 0 }), true);
  assert.equal(scrolled, true);
});
