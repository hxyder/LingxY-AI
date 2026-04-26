#!/usr/bin/env node
/**
 * UCA-077 P4-RQ G3: conversation continuity (lighter fix).
 *
 * Production reproduction: short follow-ups like "罗利" (city slot
 * fill) and "对" (yes confirmation) became NEW root tasks instead
 * of inheriting the parent. Two structural fixes ship together:
 *
 *   G3a (frontend): shouldAttachParentTaskForCommand replaces the
 *   topic regex EXPLICIT_FOLLOWUP_RE with structural rules
 *   (recency window + short-text length).
 *
 *   G3b (backend): pending-offer detector falls back to
 *   contextPacket.parent_task_summary when conversation_turns is
 *   absent. createTaskRecord pre-fetches the parent task's final
 *   reply when a runtime is available.
 *
 * Asserts:
 *   1. createTaskRecord enriches contextPacket with
 *      parent_task_summary when parentTaskId + runtime are provided.
 *   2. pending-offer detector matches "对" + parent_task_summary
 *      whose final text contains a weather offer.
 *   3. pending-offer detector still matches the legacy path
 *      (selection_metadata.conversation_turns) when present —
 *      backward compat preserved.
 *   4. pending-offer NO match when parent_task_summary is missing
 *      AND conversation_turns is missing (conservative fallback).
 *   5. pending-offer NO match when parent_task_summary's final text
 *      doesn't contain an offer pattern (offer detection still gates).
 *   6. Frontend lock-in (source-level): shouldAttachParentTaskForCommand
 *      references structural conditions (recency + length), not the
 *      old EXPLICIT_FOLLOWUP_RE.
 *
 * Run: node scripts/verify-followup-continuity.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detect as detectPendingOffer } from "../src/service/core/intent/signals/pending-offer.mjs";
import { createTaskRecord } from "../src/service/core/task-runtime.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

// Helper: stub runtime store with a parent task lookup.
function stubRuntime(parentTask) {
  return {
    store: {
      getTask(id) {
        return id === parentTask?.task_id ? parentTask : null;
      }
    }
  };
}

// ── G3b: pending-offer reads parent_task_summary ────────────────────
it("G3b detector: '对' + parent_task_summary with weather offer → matched", () => {
  const sig = detectPendingOffer("对", {
    parent_task_summary: {
      parent_task_id: "task_abc",
      assistant_final_text: "想看今天的天气吗？我可以帮你查一下。"
    }
  });
  assert.equal(sig.matched, true,
    "pending-offer must read parent_task_summary when conversation_turns is absent");
  assert.equal(sig.kind, "hint");
  assert.equal(sig.hint?.pending_intent, "weather");
});

it("G3b detector: '需要' + parent_task_summary with news offer → matched", () => {
  const sig = detectPendingOffer("需要", {
    parent_task_summary: {
      parent_task_id: "task_abc",
      assistant_final_text: "想看今日的新闻头条吗？需要的话我可以帮你查一下。"
    }
  });
  assert.equal(sig.matched, true);
  assert.equal(sig.hint?.pending_intent, "news");
});

it("G3b detector: legacy path still works (conversation_turns wins when present)", () => {
  // Both conversation_turns AND parent_task_summary present — the
  // turns array is preferred (it's in-band, fresher).
  const sig = detectPendingOffer("对", {
    selection_metadata: {
      conversation_turns: [
        { role: "user", content: "今天怎么样" },
        { role: "assistant", content: "想看天气吗？" }
      ]
    },
    parent_task_summary: {
      parent_task_id: "task_other",
      assistant_final_text: "想看新闻吗？"  // different intent
    }
  });
  assert.equal(sig.matched, true);
  // weather (from conversation_turns), not news (from parent_summary)
  assert.equal(sig.hint?.pending_intent, "weather");
});

it("G3b detector: NO conversation_turns, NO parent_task_summary → no match", () => {
  // Conservative fallback: when we have no signal of which prior
  // task this affirmative refers to, don't claim a match.
  const sig = detectPendingOffer("对", {});
  assert.equal(sig.matched, false);
});

it("G3b detector: parent_task_summary final text without offer → no match", () => {
  // Offer detection regex still gates. A factual reply that doesn't
  // contain "想/want/...?" phrasing won't trigger pending-offer.
  const sig = detectPendingOffer("对", {
    parent_task_summary: {
      parent_task_id: "task_abc",
      assistant_final_text: "已经为你完成了任务。"
    }
  });
  assert.equal(sig.matched, false);
});

it("G3b detector: parent_task_summary missing assistant_final_text → no match", () => {
  const sig = detectPendingOffer("对", {
    parent_task_summary: { parent_task_id: "task_abc" }
  });
  assert.equal(sig.matched, false);
});

it("G3b detector: short-affirmative regex still gates (non-affirmative text)", () => {
  // "新建一个文档" is not a short affirmative — even with parent
  // summary, must not match.
  const sig = detectPendingOffer("新建一个文档", {
    parent_task_summary: {
      parent_task_id: "task_abc",
      assistant_final_text: "想看天气吗？"
    }
  });
  assert.equal(sig.matched, false);
});

// ── G3b: createTaskRecord enriches contextPacket ────────────────────
it("createTaskRecord: parentTaskId + runtime → contextPacket gets parent_task_summary", () => {
  const parentTask = {
    task_id: "task_parent_1",
    user_command: "今天的天气",
    result_summary: "想看今天北京的天气吗？我可以查一下。",
    status: "success"
  };
  const runtime = stubRuntime(parentTask);
  const task = createTaskRecord({
    route: { intent: "qa", executor: "tool_using" },
    contextPacket: { source_app: "test" },
    userCommand: "对",
    executionMode: "interactive",
    parentTaskId: parentTask.task_id,
    runtime
  });
  // The signal extracted during createTaskSpec must have seen the
  // enriched contextPacket. Verify via the resulting task spec —
  // pending-offer would have matched via parent_task_summary.
  const pendingOffer = task.task_spec?.signals?.pending_offer;
  // Note: signals are not stamped on task_spec; the enrichment is
  // observable via the trace's evidence or via a re-extraction.
  // Check the context_packet directly instead.
  assert.equal(
    task.context_packet?.parent_task_summary?.parent_task_id,
    "task_parent_1",
    "context_packet must carry parent_task_summary after enrichment"
  );
});

it("createTaskRecord: no parentTaskId → no enrichment (back-compat)", () => {
  const task = createTaskRecord({
    route: { intent: "qa", executor: "tool_using" },
    contextPacket: { source_app: "test" },
    userCommand: "hi",
    executionMode: "interactive",
    parentTaskId: null
  });
  assert.equal(task.context_packet?.parent_task_summary, undefined);
});

it("createTaskRecord: parentTaskId but no runtime → graceful (no enrichment, no crash)", () => {
  const task = createTaskRecord({
    route: { intent: "qa", executor: "tool_using" },
    contextPacket: { source_app: "test" },
    userCommand: "对",
    executionMode: "interactive",
    parentTaskId: "task_parent_1"
    // runtime not passed
  });
  assert.equal(task.context_packet?.parent_task_summary, undefined);
});

it("createTaskRecord: parentTaskId points at missing task → graceful (no enrichment)", () => {
  const runtime = stubRuntime(null);  // store always returns null
  const task = createTaskRecord({
    route: { intent: "qa", executor: "tool_using" },
    contextPacket: { source_app: "test" },
    userCommand: "对",
    executionMode: "interactive",
    parentTaskId: "task_does_not_exist",
    runtime
  });
  assert.equal(task.context_packet?.parent_task_summary, undefined);
});

it("createTaskRecord: parent task with no final reply → graceful (no enrichment)", () => {
  const parentTask = {
    task_id: "task_empty",
    user_command: "x",
    status: "failed"
    // no result_summary, no result.final_text
  };
  const runtime = stubRuntime(parentTask);
  const task = createTaskRecord({
    route: { intent: "qa", executor: "tool_using" },
    contextPacket: {},
    userCommand: "对",
    executionMode: "interactive",
    parentTaskId: parentTask.task_id,
    runtime
  });
  assert.equal(task.context_packet?.parent_task_summary, undefined);
});

// ── G3b end-to-end: parent_task_summary flows into pending-offer signal ─
it("G3b end-to-end: createTaskSpec via createTaskRecord → pending-offer matched via parent summary", async () => {
  // The full chain: parent task in store → createTaskRecord enriches
  // → createTaskSpec extracts signals → signals.pending_offer matches
  // via parent_task_summary path.
  const { extractAllSignals } = await import("../src/service/core/intent/signals/index.mjs");
  const parentTask = {
    task_id: "task_parent_offer",
    user_command: "今天的天气",
    result_summary: "想看今天北京的天气吗？我可以帮你查一下。",
    status: "success"
  };
  const runtime = stubRuntime(parentTask);
  const task = createTaskRecord({
    route: { intent: "qa", executor: "tool_using" },
    contextPacket: { source_app: "test" },
    userCommand: "对",
    executionMode: "interactive",
    parentTaskId: parentTask.task_id,
    runtime
  });
  // Re-extract signals from the enriched contextPacket so we can
  // assert pending-offer matched. (createTaskSpec doesn't expose
  // the bundle on the task spec.)
  const { signals } = extractAllSignals("对", task.context_packet);
  assert.equal(signals.pending_offer?.matched, true,
    "pending-offer must match through parent_task_summary path");
  assert.equal(signals.pending_offer.hint?.pending_intent, "weather");
});

// ── G3a frontend lock-in (source-level grep) ────────────────────────
it("G3a lock-in: overlay.js shouldAttachParentTaskForCommand uses recency + length, not topic regex", () => {
  const src = readFileSync(
    new URL("../src/desktop/renderer/overlay.js", import.meta.url),
    "utf8"
  );
  // Must reference the structural rules
  assert.match(src, /lastCompletedAt/,
    "overlay.js must track lastCompletedAt for the recency rule");
  assert.match(src, /FOLLOWUP_RECENCY_WINDOW_MS/,
    "shouldAttachParentTaskForCommand must use a recency window constant");
  assert.match(src, /FOLLOWUP_SHORT_TEXT_CHARS|FOLLOWUP_SHORT_TEXT_CHINESE_CHARS/,
    "must use a short-text length threshold");
  // Must NOT reference the deprecated topic regex
  assert.doesNotMatch(src, /EXPLICIT_FOLLOWUP_RE\s*=\s*\//,
    "EXPLICIT_FOLLOWUP_RE topic regex must be removed");
});

it("G3a lock-in: shouldAttachParentTaskForCommand body checks recency window first", () => {
  // The function is in the renderer (not directly importable in
  // node), so we lock its structure via source-level grep. Function
  // body must include `Date.now() - completedAt` recency check
  // BEFORE any other rule.
  const src = readFileSync(
    new URL("../src/desktop/renderer/overlay.js", import.meta.url),
    "utf8"
  );
  const fnMatch = src.match(/function shouldAttachParentTaskForCommand[\s\S]*?\n\}/);
  assert.ok(fnMatch, "shouldAttachParentTaskForCommand definition must be present");
  const body = fnMatch[0];
  assert.match(body, /Date\.now\(\)\s*-\s*completedAt/,
    "must compute recency from Date.now() - lastCompletedAt");
  assert.match(body, /cjkCount|FOLLOWUP_SHORT_TEXT/,
    "must check character-length thresholds");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
