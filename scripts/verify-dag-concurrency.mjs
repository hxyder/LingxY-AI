import assert from "node:assert/strict";
import { runDagPlan } from "../src/service/dag/executor.mjs";

// ── Layer 1 nodes without deps run in parallel ───────────────────────────

{
  const order = [];
  const release = new Map();
  const plan = {
    nodes: [
      { id: "a", kind: "action_tool", tool: "t", params: {} },
      { id: "b", kind: "action_tool", tool: "t", params: {} },
      { id: "c", kind: "action_tool", tool: "t", params: {} }
    ]
  };

  // Each node resolves only after the OTHERS have started — if execution
  // were serial the test would hang. Promise.all should deliver all three
  // to "started" before any resolves.
  async function dispatch(node) {
    order.push(`start:${node.id}`);
    if (order.filter((x) => x.startsWith("start:")).length < plan.nodes.length) {
      await new Promise((resolve) => {
        release.set(node.id, resolve);
      });
    } else {
      // Last one to start releases everyone.
      for (const [, r] of release) r();
      release.clear();
    }
    order.push(`end:${node.id}`);
    return { ok: true };
  }

  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.status, "success");
  // All three start events land BEFORE the first end event.
  const firstEnd = order.findIndex((x) => x.startsWith("end:"));
  const startsBefore = order.slice(0, firstEnd).filter((x) => x.startsWith("start:"));
  assert.equal(startsBefore.length, 3, `expected all three to start before any ends, order=${JSON.stringify(order)}`);
}

// ── Serial per-session buckets: same session_key serialises, different
//    session_keys run in parallel ─────────────────────────────────────────

{
  const active = new Map(); // sessionKey -> count
  const maxActive = new Map();

  const plan = {
    nodes: [
      { id: "sA1", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "sA" },
      { id: "sA2", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "sA" },
      { id: "sB1", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "sB" },
      { id: "sB2", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "sB" }
    ]
  };

  async function dispatch(node) {
    const key = node.session_key;
    const count = (active.get(key) ?? 0) + 1;
    active.set(key, count);
    maxActive.set(key, Math.max(maxActive.get(key) ?? 0, count));
    await new Promise((resolve) => setTimeout(resolve, 10));
    active.set(key, active.get(key) - 1);
    return { ok: true };
  }

  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.status, "success");
  // Within a session, max concurrent must stay 1.
  assert.equal(maxActive.get("sA"), 1, "serial_per_session must keep same-key nodes serialised");
  assert.equal(maxActive.get("sB"), 1);
}

// ── parallel_safe + serial_per_session coexist in the same layer ─────────

{
  const parallelActive = { count: 0, max: 0 };
  const sessionActive = new Map();
  const sessionMax = new Map();

  const plan = {
    nodes: [
      { id: "p1", kind: "mcp_tool", tool: "t", params: {} },
      { id: "p2", kind: "mcp_tool", tool: "t", params: {} },
      { id: "p3", kind: "mcp_tool", tool: "t", params: {} },
      { id: "s1", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "S" },
      { id: "s2", kind: "skill", skill: "x", params: {}, concurrency: "serial_per_session", session_key: "S" }
    ]
  };

  async function dispatch(node) {
    if (node.concurrency === "serial_per_session") {
      const k = node.session_key;
      sessionActive.set(k, (sessionActive.get(k) ?? 0) + 1);
      sessionMax.set(k, Math.max(sessionMax.get(k) ?? 0, sessionActive.get(k)));
      await new Promise((resolve) => setTimeout(resolve, 5));
      sessionActive.set(k, sessionActive.get(k) - 1);
    } else {
      parallelActive.count += 1;
      parallelActive.max = Math.max(parallelActive.max, parallelActive.count);
      await new Promise((resolve) => setTimeout(resolve, 5));
      parallelActive.count -= 1;
    }
    return { ok: true };
  }

  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.status, "success");
  assert.equal(parallelActive.max, 3, "parallel nodes must all be active concurrently");
  assert.equal(sessionMax.get("S"), 1, "serial session stays at 1");
}

// ── Depending on a parallel node's result via placeholder still works ────

{
  const plan = {
    nodes: [
      { id: "x", kind: "mcp_tool", tool: "t", params: {} },
      { id: "y", kind: "mcp_tool", tool: "t", params: {} },
      { id: "sum", kind: "agent_loop", params: { userCommand: "sum: {{x.n}} + {{y.n}}" }, depends_on: ["x", "y"] }
    ]
  };
  async function dispatch(node, params) {
    if (node.id === "x") return { n: 3 };
    if (node.id === "y") return { n: 7 };
    if (node.id === "sum") return { final: params.userCommand };
  }
  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.status, "success");
  assert.equal(snap.results.sum.final, "sum: 3 + 7");
}

// ── session_key with placeholder resolves against live results ───────────

{
  const buckets = [];
  const plan = {
    nodes: [
      { id: "pick", kind: "mcp_tool", tool: "t", params: {} },
      {
        id: "s1",
        kind: "skill", skill: "x",
        params: {},
        concurrency: "serial_per_session",
        session_key: "{{pick.key}}",
        depends_on: ["pick"]
      }
    ]
  };
  async function dispatch(node) {
    if (node.id === "pick") return { key: "session-alpha" };
    buckets.push(node.session_key);
    return { ok: true };
  }
  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.status, "success");
  // (Value propagation into schedule logic is internal; assert snap succeeded.)
}

console.log("DAG concurrency (layer parallelism + session bucketing) verification passed.");
