import assert from "node:assert/strict";
import test from "node:test";

import {
  groupMessagesIntoTurns,
  pickTurnsWithinBudget
} from "../../src/service/executors/shared/conversation-history-loader.mjs";

function plainTurn(triggerSeq, chars = 120) {
  return {
    triggerSeq,
    anyPartial: false,
    messages: [
      { role: "user", seq: triggerSeq, content: `plain-user-${triggerSeq}`.padEnd(chars, "u") },
      { role: "assistant", seq: triggerSeq + 1, content: `plain-assistant-${triggerSeq}`.padEnd(chars, "a") }
    ]
  };
}

test("history budget preserves high-value artifact turns ahead of newer plain chat", () => {
  const olderHighValue = {
    triggerSeq: 10,
    anyPartial: false,
    messages: [
      { role: "user", seq: 10, content: "generate the report".padEnd(120, "u") },
      {
        role: "assistant",
        seq: 11,
        content: "report ready".padEnd(120, "a"),
        metadata: {
          artifact_paths: ["E:\\linxiDoc\\task\\report.docx"],
          evidence_summary: { source_count: 2 }
        }
      }
    ]
  };
  const newerPlain = [
    plainTurn(20),
    plainTurn(30),
    plainTurn(40)
  ];

  const picked = pickTurnsWithinBudget([olderHighValue, ...newerPlain], 130);
  const seqs = picked.map((message) => message.seq);

  assert.ok(seqs.includes(10) && seqs.includes(11), "artifact-bearing turn must survive tight history budget");
  assert.ok(seqs.includes(40) && seqs.includes(41), "newest plain turn should remain when budget allows");
  assert.ok(!seqs.includes(20), "older plain chat can be dropped before older artifact context");
});

test("history grouping treats tool summaries as high-value turn material", () => {
  const turns = groupMessagesIntoTurns([
    { role: "user", seq: 1, content: "research the topic".padEnd(80, "u") },
    { role: "assistant", seq: 2, content: "I searched.".padEnd(80, "a") },
    {
      role: "tool_summary",
      seq: 3,
      content: JSON.stringify({
        tool_id: "web_search_fetch",
        success: true,
        source_count: 4,
        artifact_ids: ["artifact_report"]
      })
    },
    ...plainTurn(10, 100).messages,
    ...plainTurn(20, 100).messages
  ]);

  const picked = pickTurnsWithinBudget(turns, 125);
  const seqs = picked.map((message) => message.seq);

  assert.ok(seqs.includes(1) && seqs.includes(2) && seqs.includes(3));
  assert.ok(!seqs.includes(10), "plain turns have lower retention priority than tool-summary turns");
});

test("history budget keeps the newest plain turn before older high-value turns fill remaining budget", () => {
  const highValueTurns = [
    {
      triggerSeq: 1,
      anyPartial: false,
      messages: [
        { role: "user", seq: 1, content: "old report".padEnd(120, "u") },
        {
          role: "assistant",
          seq: 2,
          content: "old artifact".padEnd(120, "a"),
          metadata: { artifact_paths: ["E:\\old\\a.docx"] }
        }
      ]
    },
    {
      triggerSeq: 3,
      anyPartial: false,
      messages: [
        { role: "user", seq: 3, content: "older evidence".padEnd(120, "u") },
        {
          role: "assistant",
          seq: 4,
          content: "older sources".padEnd(120, "a"),
          metadata: { evidence_summary: { source_count: 3 } }
        }
      ]
    }
  ];
  const newestPlain = plainTurn(100, 120);

  const picked = pickTurnsWithinBudget([...highValueTurns, newestPlain], 130);
  const seqs = picked.map((message) => message.seq);

  assert.ok(seqs.includes(100) && seqs.includes(101), "newest plain context gets a retention slot");
  assert.ok(seqs.includes(3) && seqs.includes(4), "remaining budget still keeps newest high-value turn");
});
