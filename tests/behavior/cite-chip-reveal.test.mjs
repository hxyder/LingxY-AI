import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  renderEvidenceSourcesHtml,
  revealEvidenceSource
} from "../../src/desktop/renderer/evidence-sources-view.mjs";
import {
  renderChatMessageBlocksHtml
} from "../../src/desktop/renderer/chat-blocks.mjs";

test("citation chips can reveal the matching source row", () => {
  const { document } = parseHTML(`
    <main>
      <section id="answer">${renderChatMessageBlocksHtml("Grounded answer [w_abcd1234].")}</section>
      ${renderEvidenceSourcesHtml({
        source_count: 1,
        distinct_domain_count: 1,
        sources: [
          {
            id: "w_abcd1234",
            kind: "web",
            locator: "https://example.com/report",
            title: "Report"
          }
        ]
      })}
    </main>
  `);

  const chip = document.querySelector(".cite-chip[data-source-id='w_abcd1234']");
  const row = document.querySelector("[data-evidence-source-row][data-source-id='w_abcd1234']");
  assert.ok(chip, "citation chip should render with the source id");
  assert.ok(row, "evidence panel should render a matching source row");
  let scrolled = false;
  row.scrollIntoView = () => { scrolled = true; };

  assert.equal(revealEvidenceSource(document, chip.dataset.sourceId, { flashMs: 0 }), true);
  assert.equal(scrolled, true);
  assert.ok(row.classList.contains("cite-source-row--flash"));
});

test("unresolved citation diagnostics render as advisory warning chips", () => {
  const html = renderEvidenceSourcesHtml({
    source_count: 1,
    distinct_domain_count: 1,
    sources: [
      {
        id: "w_abcd1234",
        kind: "web",
        locator: "https://example.com/report",
        title: "Report"
      }
    ],
    citations: {
      claimed: ["w_deadbeef"],
      missing: ["w_deadbeef"],
      claim_density: 1
    }
  });

  assert.match(html, /data-citation-diagnostic="unresolved"/);
  assert.match(html, /1 unresolved citation/);
  assert.match(html, /title="w_deadbeef"/);
});
