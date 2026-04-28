#!/usr/bin/env node
/**
 * detectSearchSaturation: soft saturation nudge for multi_source / deep
 * research tasks. Pure helper next to extractEvidence in
 * evidence-normalizer.mjs. The agent-loop / agentic planner read it after
 * each tool result and inject a one-shot system note when the most
 * recent N web fetches added no new registrable domains beyond what came
 * before. Asserts:
 *
 *   1. Empty / undersized transcripts never saturate.
 *   2. Window of repeated domains over a populated baseline saturates.
 *   3. A single new domain in the window breaks saturation.
 *   4. fetch_url_content URLs participate alongside web_search_fetch.
 *   5. Failed entries don't contribute to either side.
 *   6. Mixed-tool transcripts: domains aggregate across tool kinds.
 *   7. Zero-domain windows are not saturation (noise, not stuck).
 *   8. registrableDomain dedupe: www.example.com == example.com.
 *   9. Custom windowSize honored; bad inputs (0 / Infinity / NaN) safe.
 *
 * Run: node scripts/verify-search-saturation.mjs
 */

import assert from "node:assert/strict";

import { detectSearchSaturation } from "../src/service/core/policy/evidence-normalizer.mjs";
import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";

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

function searchHit(urls) {
  return {
    type: "tool_result",
    tool: "web_search_fetch",
    success: true,
    metadata: { results: urls.map((url) => ({ url, title: "t" })) }
  };
}
function fetchHit(url) {
  return {
    type: "tool_result",
    tool: "fetch_url_content",
    success: true,
    metadata: { url }
  };
}
function failedSearchHit(urls) {
  return {
    type: "tool_result",
    tool: "web_search_fetch",
    success: false,
    metadata: { results: urls.map((url) => ({ url, title: "t" })) }
  };
}

it("empty transcript → not saturated", () => {
  const r = detectSearchSaturation([], 3);
  assert.equal(r.saturated, false);
  assert.equal(r.window_size, 3);
  assert.deepEqual(r.repeated_domains, []);
});

it("undersized transcript (window+0) → not saturated", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/x"]),
    searchHit(["https://b.com/x"]),
    searchHit(["https://c.com/x"])
  ], 3);
  // window+0 means there's no baseline; refuse to saturate
  assert.equal(r.saturated, false);
});

it("baseline repeated across full window → saturated, repeated domains reported", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1", "https://b.com/1"]),
    searchHit(["https://a.com/2"]),
    searchHit(["https://b.com/3"]),
    searchHit(["https://a.com/4"])
  ], 3);
  assert.equal(r.saturated, true);
  assert.equal(r.window_size, 3);
  assert.deepEqual(r.repeated_domains, ["a.com", "b.com"]);
  assert.equal(r.baseline_domain_count, 2);
});

it("single new domain in window breaks saturation", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    searchHit(["https://a.com/2"]),
    searchHit(["https://a.com/3"]),
    searchHit(["https://newpub.org/1"])
  ], 3);
  assert.equal(r.saturated, false);
  // baseline still surfaced for diagnostics
  assert.equal(r.baseline_domain_count, 1);
});

it("fetch_url_content URLs participate", () => {
  const r = detectSearchSaturation([
    fetchHit("https://a.com/article-1"),
    fetchHit("https://a.com/article-2"),
    fetchHit("https://a.com/article-3"),
    fetchHit("https://a.com/article-4")
  ], 3);
  assert.equal(r.saturated, true);
  assert.deepEqual(r.repeated_domains, ["a.com"]);
});

it("failed entries skipped on both sides", () => {
  // Window's a.com only repeats baseline because the b.com hit failed.
  // If failures counted, baseline would include b.com and the window
  // would still be 100% repeats (still saturate). Inverse: the b.com
  // hit at the tail SHOULD be a new domain that breaks saturation.
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    searchHit(["https://a.com/2"]),
    failedSearchHit(["https://b.com/1"]),  // failed → not in baseline
    searchHit(["https://a.com/3"]),
    searchHit(["https://b.com/2"])         // tail b.com → new domain
  ], 3);
  // window is the last 3: failed_b, a.com/3, b.com/2.
  // failed entry is dropped from web hits entirely → window becomes the
  // last 3 *successful* web hits: a/1, a/2, a/3, b/2 → wait: 4 successful
  // hits, window=last 3 → a/2, a/3, b/2. Baseline = a/1.
  // Window has b.com which is new. Not saturated.
  assert.equal(r.saturated, false);
});

it("mixed tools: domains aggregate across web_search_fetch + fetch_url_content", () => {
  const r = detectSearchSaturation([
    searchHit(["https://x.com/1"]),
    fetchHit("https://x.com/article"),
    searchHit(["https://x.com/2"]),
    fetchHit("https://x.com/article-2")
  ], 3);
  assert.equal(r.saturated, true);
  assert.deepEqual(r.repeated_domains, ["x.com"]);
});

it("zero-domain window (no metadata.results) not flagged as saturated", () => {
  const blank = {
    type: "tool_result",
    tool: "web_search_fetch",
    success: true,
    metadata: {}
  };
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    blank,
    blank,
    blank
  ], 3);
  // Window has zero domains → noise, not saturation
  assert.equal(r.saturated, false);
});

it("registrableDomain dedupe: www.example.com counted same as example.com", () => {
  const r = detectSearchSaturation([
    searchHit(["https://www.example.com/1"]),
    searchHit(["https://example.com/2"]),
    searchHit(["https://example.com/3"]),
    searchHit(["https://www.example.com/4"])
  ], 3);
  assert.equal(r.saturated, true);
  assert.deepEqual(r.repeated_domains, ["example.com"]);
});

it("non-web tools ignored (read_clipboard, write_file etc.)", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    { type: "tool_result", tool: "write_file", success: true, metadata: {} },
    searchHit(["https://a.com/2"]),
    { type: "tool_result", tool: "read_clipboard", success: true, metadata: {} },
    searchHit(["https://a.com/3"]),
    searchHit(["https://a.com/4"])
  ], 3);
  // 4 web hits, window=3, all a.com → saturated
  assert.equal(r.saturated, true);
});

it("custom windowSize=2 honored", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    searchHit(["https://b.com/1"]),
    searchHit(["https://a.com/2"]),
    searchHit(["https://b.com/2"])
  ], 2);
  // baseline = a, b; window = a, b → all repeat → saturated
  assert.equal(r.saturated, true);
  assert.equal(r.window_size, 2);
});

it("invalid windowSize (0) → not saturated, safe", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    searchHit(["https://a.com/2"])
  ], 0);
  assert.equal(r.saturated, false);
  assert.equal(r.window_size, 0);
});

it("invalid windowSize (NaN) → not saturated, safe", () => {
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),
    searchHit(["https://a.com/2"])
  ], NaN);
  assert.equal(r.saturated, false);
});

it("non-array transcript → not saturated, safe", () => {
  const r = detectSearchSaturation(null, 3);
  assert.equal(r.saturated, false);
});

it("malformed urls in baseline don't crash, don't count", () => {
  const r = detectSearchSaturation([
    searchHit(["not-a-url"]),
    searchHit(["https://a.com/1"]),
    searchHit(["https://a.com/2"]),
    searchHit(["https://a.com/3"]),
    searchHit(["https://a.com/4"])
  ], 3);
  // baseline domains = {a.com} (malformed dropped)
  // window = a, a, a → all repeat → saturated
  assert.equal(r.saturated, true);
});

it("windowSize+1 entries → one baseline hit is enough to detect repeated-domain saturation", () => {
  // exactly windowSize+1 entries means baseline is 1 hit. We DO saturate
  // when the 3-entry window repeats that 1 baseline domain. This locks
  // in that the threshold is `>` windowSize, not `>=` windowSize.
  const r = detectSearchSaturation([
    searchHit(["https://a.com/1"]),  // baseline (1)
    searchHit(["https://a.com/2"]),
    searchHit(["https://a.com/3"]),
    searchHit(["https://a.com/4"])
  ], 3);
  assert.equal(r.saturated, true);
});

// ── Integration: hint actually injects into the next planner turn ──
//
// Scripts a planner that issues 4 successful web_search_fetch calls all
// returning the same domain, then a final text turn. Asserts:
//   - the agent-loop pushed a `saturation_hint` transcript entry
//   - the loop emitted a `saturation_hint` task event
//   - the planner saw the hint in transcript on the call AFTER detection
//   - it fires once, not on every subsequent tool call

function makeWebSearchToolRegistry({ resultsByCallIndex }) {
  let callIndex = 0;
  const tool = {
    id: "web_search_fetch",
    description: "Web search",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    policy_group: "external_web_read"
  };
  return {
    list: () => [tool],
    get: (id) => (id === "web_search_fetch" ? tool : null),
    call: async () => {
      const results = resultsByCallIndex[callIndex] ?? resultsByCallIndex[resultsByCallIndex.length - 1];
      callIndex += 1;
      // observation must be >32 chars so toolResultHasSubstance returns true;
      // otherwise the agent-loop charges an empty_search_result and bails on
      // the first call (default budget is max_empty_search_results=1).
      return {
        success: true,
        observation: `Search returned ${results.length} results, including: ${results.join(", ")}. Snippets omitted for brevity.`,
        metadata: { results: results.map((url) => ({ url, title: "t" })) }
      };
    },
    evaluate: () => ({ risk_level: "low", requires_confirmation: false })
  };
}

function makeStubRuntime({ toolRegistry, emittedEvents }) {
  return {
    actionToolRegistry: toolRegistry,
    toolContext: {},
    connectorCatalog: null,
    store: { appendAuditLog: () => {}, getTask: () => null, updateTask: () => {} },
    securityBroker: { authorizeToolCall: () => ({ allowed: true, reason: null }) },
    emitTaskEvent: (typeOrId, maybeType, maybePayload) => {
      if (typeof maybeType === "string") {
        emittedEvents.push({ event_type: maybeType, payload: maybePayload });
      } else {
        emittedEvents.push({ event_type: typeOrId, payload: maybeType });
      }
    }
  };
}

function makeMultiSourceTask(userCommand) {
  return {
    task_id: `t_${Math.random().toString(36).slice(2, 9)}`,
    user_command: userCommand,
    context_packet: { text: "" },
    route: { executor: "tool_using" },
    task_spec: {
      goal: "qa",
      research_quality: { profile: "multi_source_research", min_sources: 3, min_distinct_domains: 2 },
      tool_policy: { policy_groups: { external_web_read: { mode: "required" } } }
    }
  };
}

function makeScriptedPlanner(scriptFn) {
  const seenTranscripts = [];
  return {
    planner: async ({ transcript, iteration }) => {
      const snapshot = transcript.map((e) => ({ type: e.type, tool: e.tool }));
      seenTranscripts.push({ iteration, transcript: snapshot });
      return scriptFn({ iteration, transcript });
    },
    seenTranscripts
  };
}

async function integrationTest(label, fn) {
  try {
    await fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

await integrationTest("integration: multi_source profile + 4 same-domain hits → hint injected once", async () => {
  const registry = makeWebSearchToolRegistry({
    resultsByCallIndex: [
      ["https://a.com/1"],
      ["https://a.com/2"],
      ["https://a.com/3"],
      ["https://a.com/4"]
    ]
  });
  const events = [];
  const runtime = makeStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner, seenTranscripts } = makeScriptedPlanner(({ iteration }) => {
    if (iteration < 4) return { type: "tool_call", tool: "web_search_fetch", args: { query: `q${iteration}` } };
    return { type: "final", text: "synthesized answer based on a.com." };
  });
  const task = makeMultiSourceTask("最近 AI 圈的进展");
  task.__runtime = runtime;

  const result = await runToolAgentLoop({ task, runtime, planner, maxIterations: 8 });

  const hintEntries = result.transcript.filter((e) => e.type === "saturation_hint");
  assert.equal(hintEntries.length, 1, `expected 1 saturation_hint transcript entry, got ${hintEntries.length}`);
  assert.equal(hintEntries[0].window_size, 3);
  assert.deepEqual(hintEntries[0].repeated_domains, ["a.com"]);

  const hintEvents = events.filter((e) => e.event_type === "saturation_hint");
  assert.equal(hintEvents.length, 1, `expected 1 saturation_hint event, got ${hintEvents.length}`);

  // The planner call AFTER detection should see the hint in its transcript
  // snapshot. Detection happens after the 4th tool result (call index 3),
  // so iteration 4 is the first planner call that saw it.
  const iter4 = seenTranscripts.find((s) => s.iteration === 4);
  assert(iter4, "expected planner to be invoked at iteration 4");
  assert(iter4.transcript.some((e) => e.type === "saturation_hint"),
    "iteration 4 planner should see saturation_hint in transcript");
});

await integrationTest("integration: single_lookup profile → no hint even with 4 same-domain hits", async () => {
  const registry = makeWebSearchToolRegistry({
    resultsByCallIndex: [
      ["https://a.com/1"], ["https://a.com/2"], ["https://a.com/3"], ["https://a.com/4"]
    ]
  });
  const events = [];
  const runtime = makeStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner } = makeScriptedPlanner(({ iteration }) => {
    if (iteration < 4) return { type: "tool_call", tool: "web_search_fetch", args: { query: `q${iteration}` } };
    return { type: "final", text: "single source is fine." };
  });
  const task = makeMultiSourceTask("a.com 上那篇怎么说的");
  task.task_spec.research_quality = { profile: "single_lookup", min_sources: 1, min_distinct_domains: 1 };
  task.__runtime = runtime;

  const result = await runToolAgentLoop({ task, runtime, planner, maxIterations: 8 });

  const hintEntries = result.transcript.filter((e) => e.type === "saturation_hint");
  assert.equal(hintEntries.length, 0, "single_lookup must not fire saturation hint");
  const hintEvents = events.filter((e) => e.event_type === "saturation_hint");
  assert.equal(hintEvents.length, 0);
});

await integrationTest("integration: window broken by new domain → no hint", async () => {
  const registry = makeWebSearchToolRegistry({
    resultsByCallIndex: [
      ["https://a.com/1"], ["https://a.com/2"], ["https://a.com/3"], ["https://newpub.org/1"]
    ]
  });
  const events = [];
  const runtime = makeStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner } = makeScriptedPlanner(({ iteration }) => {
    if (iteration < 4) return { type: "tool_call", tool: "web_search_fetch", args: { query: `q${iteration}` } };
    return { type: "final", text: "good coverage." };
  });
  const task = makeMultiSourceTask("最近 AI 圈的进展");
  task.__runtime = runtime;

  const result = await runToolAgentLoop({ task, runtime, planner, maxIterations: 8 });
  const hintEntries = result.transcript.filter((e) => e.type === "saturation_hint");
  assert.equal(hintEntries.length, 0, "new domain in the window must break saturation");
});

await integrationTest("integration: hint fires at most once even when saturation persists", async () => {
  // 6 same-domain calls — should fire exactly once, not on every subsequent
  // tool result after the threshold.
  const registry = makeWebSearchToolRegistry({
    resultsByCallIndex: [
      ["https://a.com/1"], ["https://a.com/2"], ["https://a.com/3"],
      ["https://a.com/4"], ["https://a.com/5"], ["https://a.com/6"]
    ]
  });
  const events = [];
  const runtime = makeStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner } = makeScriptedPlanner(({ iteration }) => {
    if (iteration < 6) return { type: "tool_call", tool: "web_search_fetch", args: { query: `q${iteration}` } };
    return { type: "final", text: "answer." };
  });
  const task = makeMultiSourceTask("ai 工具最新动态");
  task.__runtime = runtime;

  const result = await runToolAgentLoop({ task, runtime, planner, maxIterations: 10 });

  const hintEntries = result.transcript.filter((e) => e.type === "saturation_hint");
  assert.equal(hintEntries.length, 1, `expected exactly 1 saturation_hint entry, got ${hintEntries.length}`);
  const hintEvents = events.filter((e) => e.event_type === "saturation_hint");
  assert.equal(hintEvents.length, 1);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
