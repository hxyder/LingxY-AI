import assert from "node:assert/strict";
import { createJsonLinesParser, readOpenAiStyleSseStream } from "../src/service/dag/stream-parser.mjs";
import { createStreamingDagRun } from "../src/service/dag/streaming-executor.mjs";
import { planDagStreaming } from "../src/service/dag/streaming-planner.mjs";

// ── JsonLinesParser: handles partial chunks + code fences + comments ─────

{
  const lines = [];
  const errors = [];
  const parser = createJsonLinesParser({
    onLine: (obj) => lines.push(obj),
    onError: (e) => errors.push(e.line)
  });

  // Simulate a real chunk stream: partial line, complete line, partial.
  parser.feed(`{"id":"s1","k`);
  assert.equal(lines.length, 0, "partial chunk shouldn't emit");
  parser.feed(`ind":"action_tool","tool":"notify","params":{}}\n`);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, "s1");

  parser.feed(`{"summary":"quick plan"}\n{"id":"s2","kind":"action_tool","tool":"t","params":{}}`);
  parser.flush();
  assert.equal(lines.length, 3);
  assert.equal(lines[1].summary, "quick plan");
  assert.equal(lines[2].id, "s2");

  // Code fence + junk lines should be ignored.
  const lines2 = [];
  const p2 = createJsonLinesParser({ onLine: (obj) => lines2.push(obj) });
  p2.feed('```json\n{"id":"x","kind":"action_tool","tool":"t","params":{}}\n```\n');
  assert.equal(lines2.length, 1);
  assert.equal(lines2[0].id, "x");

  // Malformed line triggers onError but doesn't crash.
  const bad = [];
  const p3 = createJsonLinesParser({
    onLine: () => {},
    onError: (e) => bad.push(e.line)
  });
  p3.feed("not json at all\n");
  p3.flush();
  assert.equal(bad.length, 1);
}

// ── readOpenAiStyleSseStream: parses SSE frames into content deltas ──────

{
  const deltas = [];
  const body = [
    `data: {"choices":[{"delta":{"content":"hello "}}]}\n\n`,
    `data: {"choices":[{"delta":{"content":"world"}}]}\n\n`,
    `data: [DONE]\n\n`
  ].join("");

  // Build a minimal Response-like object with a ReadableStream body.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  const response = { body: stream };
  await readOpenAiStyleSseStream(response, { onDelta: (d) => deltas.push(d) });
  assert.equal(deltas.join(""), "hello world");
}

// Split across chunks: SSE parsing must still align frames correctly.
{
  const deltas = [];
  const enc = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"con',
    'tent":"part 1"}}]}\n\ndata: {"choices":[{"delta":{"content":"part 2"}}]}\n\n'
  ];
  const stream = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    }
  });
  await readOpenAiStyleSseStream({ body: stream }, { onDelta: (d) => deltas.push(d) });
  assert.equal(deltas.join(""), "part 1part 2");
}

// ── createStreamingDagRun: eager dispatch when deps arrive ───────────────

{
  const events = [];
  const startedAt = {};
  const endedAt = {};
  let tick = 0;

  async function dispatch(node) {
    startedAt[node.id] = ++tick;
    await new Promise((r) => setTimeout(r, 5));
    endedAt[node.id] = ++tick;
    return { nodeId: node.id };
  }

  const run = createStreamingDagRun({
    dispatchNode: dispatch,
    onEvent: (e) => events.push(e)
  });

  // Feed nodes one at a time with delays between — simulating a stream.
  run.addNode({ id: "a", kind: "action_tool", tool: "t", params: {} });
  await new Promise((r) => setTimeout(r, 2));
  run.addNode({ id: "b", kind: "action_tool", tool: "t", params: {} });
  await new Promise((r) => setTimeout(r, 2));
  // Late-arriving dependency — "c" references "a" which may or may not
  // still be running; either way the executor should let it run once "a"
  // is successful.
  run.addNode({ id: "c", kind: "action_tool", tool: "t", params: {}, depends_on: ["a"] });
  const snap = await run.flush();

  assert.equal(snap.status, "success");
  assert.equal(Object.keys(snap.results).length, 3);
  // Interleaving property: a and b both started BEFORE c ran, because c
  // depends on a. Since a and b have no deps they were dispatched
  // immediately on arrival.
  assert(startedAt.a !== undefined && startedAt.b !== undefined && startedAt.c !== undefined);
  assert(startedAt.a < endedAt.a);
  assert(endedAt.a <= startedAt.c, "c must start only after a succeeds");
  // The plan_streaming_started event always leads off.
  assert.equal(events[0].type, "plan_streaming_started");
  // At some point node_started events for a + b land before a finishes
  // (i.e. the executor didn't wait for all nodes to arrive before
  // dispatching). Verify by finding the index of each event.
  const aStartedIdx = events.findIndex((e) => e.type === "node_started" && e.node_id === "a");
  const bStartedIdx = events.findIndex((e) => e.type === "node_started" && e.node_id === "b");
  const cArrivedIdx = events.findIndex((e) => e.type === "plan_node_received" && e.node_id === "c");
  assert(aStartedIdx >= 0 && bStartedIdx >= 0 && cArrivedIdx >= 0);
  assert(aStartedIdx < cArrivedIdx, "a started before c even arrived (true interleaving)");
}

// ── Placeholder across streamed nodes ────────────────────────────────────

{
  const run = createStreamingDagRun({
    dispatchNode: async (node, params) => {
      if (node.id === "x") return { value: 7 };
      if (node.id === "y") return { echoed: params.v };
    }
  });
  run.addNode({ id: "x", kind: "action_tool", tool: "t", params: {} });
  run.addNode({ id: "y", kind: "action_tool", tool: "t", params: { v: "{{x.value}}" }, depends_on: ["x"] });
  const snap = await run.flush();
  assert.equal(snap.status, "success");
  assert.equal(snap.results.y.echoed, 7);
}

// ── Failure in a mid-stream node blocks dependents, succeeds peers ──────

{
  const run = createStreamingDagRun({
    dispatchNode: async (node) => {
      if (node.id === "bad") throw new Error("nope");
      return { ok: true };
    }
  });
  run.addNode({ id: "good1", kind: "action_tool", tool: "t", params: {} });
  run.addNode({ id: "bad", kind: "action_tool", tool: "t", params: {}, on_failure: "skip" });
  run.addNode({ id: "downstream", kind: "action_tool", tool: "t", params: {}, depends_on: ["bad"] });
  run.addNode({ id: "peer", kind: "action_tool", tool: "t", params: {} });
  const snap = await run.flush();

  assert.equal(snap.statuses.good1, "success");
  assert.equal(snap.statuses.bad, "skipped");
  assert.equal(snap.statuses.downstream, "blocked");
  assert.equal(snap.statuses.peer, "success");
  assert.equal(snap.status, "success", "skip-on-failure keeps plan alive");
}

// ── Node with deps that never arrive → blocked when stream closes ───────

{
  const run = createStreamingDagRun({ dispatchNode: async () => ({}) });
  run.addNode({ id: "ghost_dep_consumer", kind: "action_tool", tool: "t", params: {}, depends_on: ["ghost"] });
  const snap = await run.flush();
  assert.equal(snap.statuses.ghost_dep_consumer, "blocked");
}

// ── Duplicate id rejected ────────────────────────────────────────────────

{
  const events = [];
  const run = createStreamingDagRun({
    dispatchNode: async () => ({ ok: true }),
    onEvent: (e) => events.push(e)
  });
  run.addNode({ id: "dup", kind: "action_tool", tool: "t", params: {} });
  run.addNode({ id: "dup", kind: "action_tool", tool: "t", params: {} });
  await run.flush();
  assert.ok(events.some((e) => e.type === "plan_node_rejected" && e.reason === "duplicate_id"));
}

// ── serial_per_session semantics across streamed nodes ───────────────────

{
  const active = new Map();
  const peak = new Map();
  const run = createStreamingDagRun({
    dispatchNode: async (node) => {
      const k = node.session_key;
      active.set(k, (active.get(k) ?? 0) + 1);
      peak.set(k, Math.max(peak.get(k) ?? 0, active.get(k)));
      await new Promise((r) => setTimeout(r, 5));
      active.set(k, active.get(k) - 1);
      return {};
    }
  });
  run.addNode({ id: "a1", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "A" });
  run.addNode({ id: "a2", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "A" });
  run.addNode({ id: "b1", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "B" });
  const snap = await run.flush();
  assert.equal(snap.status, "success");
  assert.equal(peak.get("A"), 1, "same session must stay serial");
  assert.equal(peak.get("B"), 1);
}

// ── planDagStreaming end-to-end via injected streamReader ────────────────

{
  const seen = [];
  let header;
  const fakeBody = [
    `{"summary":"multi city","expected_nodes":3}\n`,
    `{"id":"sh","kind":"mcp_tool","tool":"weather.current","params":{"city":"Shanghai"}}\n`,
    `{"id":"bj","kind":"mcp_tool","tool":"weather.current","params":{"city":"Beijing"}}\n`,
    `{"id":"cmp","kind":"agent_loop","params":{"userCommand":"compare {{sh}} vs {{bj}}"},"depends_on":["sh","bj"]}\n`,
    `{"done":true}\n`
  ].join("");
  const r = await planDagStreaming({
    userCommand: "compare weather",
    runtime: {
      actionToolRegistry: { list: () => [{ id: "weather.current", description: "" }] }
    },
    contextPacket: null,
    onNode: (n) => seen.push(n),
    onHeader: (h) => { header = h; },
    streamReader: async ({ onDelta }) => {
      // Stream in 20-byte chunks to prove parser handles splits.
      for (let i = 0; i < fakeBody.length; i += 20) {
        onDelta(fakeBody.slice(i, i + 20));
      }
    }
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.nodeCount, 3);
  assert.equal(header.summary, "multi city");
  assert.deepEqual(seen.map((n) => n.id), ["sh", "bj", "cmp"]);
}

// streamReader throws → ok:false with reason.
{
  const r = await planDagStreaming({
    userCommand: "x",
    runtime: { actionToolRegistry: { list: () => [] } },
    contextPacket: null,
    onNode: () => {},
    streamReader: async () => { throw new Error("network fell over"); }
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "stream_error");
}

// Zero nodes streamed → ok:false with reason "no_nodes_streamed".
{
  const r = await planDagStreaming({
    userCommand: "x",
    runtime: { actionToolRegistry: { list: () => [] } },
    contextPacket: null,
    onNode: () => {},
    streamReader: async ({ onDelta }) => { onDelta(`{"summary":"no nodes here"}\n`); }
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_nodes_streamed");
}

console.log("DAG streaming (parser + SSE + streaming executor + streaming planner) verification passed.");
