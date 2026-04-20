/**
 * Streaming DAG executor — accepts nodes one at a time and eagerly
 * dispatches any node whose declared dependencies are all satisfied (or
 * will never arrive because another branch is already "done enough").
 *
 * Contract (intentionally narrow):
 *   const run = createStreamingDagRun({ dispatchNode, onEvent })
 *   run.addNode(node)                    // call when planner emits a node
 *   const snap = await run.flush()       // call after planner stream ends
 *
 * flush() waits until every node has either succeeded, been skipped, or
 * been blocked by an upstream failure, then returns the same snapshot
 * shape runDagPlan emits: {status, results, statuses, failedNodeId, failure}.
 *
 * Within-layer concurrency reuses the same policy as the batch executor
 * (parallel_safe runs free, serial_per_session buckets by resolved
 * session_key). The difference is there are no "layers" computed up-front
 * — readiness is evaluated every time a new node arrives or a running
 * node completes.
 */

import { resolveParams, PlaceholderUnresolvedError } from "./placeholder.mjs";

function parseOnFailure(node) {
  const raw = String(node.on_failure ?? "fail");
  const [policy, argStr = ""] = raw.split(":");
  const arg = Number(argStr);
  return { policy, arg: Number.isFinite(arg) ? arg : null };
}

export function createStreamingDagRun({ dispatchNode, onEvent = () => {}, seededResults = null } = {}) {
  const nodesById = new Map();
  const dependents = new Map(); // nodeId → [childIds]
  const results = { ...(seededResults ?? {}) };
  const statuses = {};
  for (const id of Object.keys(results)) statuses[id] = "success";

  const serialBuckets = new Map(); // sessionKey → { busy: boolean, queue: [ids] }
  const inFlight = new Map();      // nodeId → promise
  let failedNodeId = null;
  let failure = null;
  let streamClosed = false;
  let flushResolve = null;
  let flushPromise = new Promise((resolve) => { flushResolve = resolve; });

  onEvent({ type: "plan_streaming_started" });

  function childrenOf(id) {
    return dependents.get(id) ?? [];
  }

  function registerEdges(node) {
    dependents.set(node.id, []);
    for (const parent of node.depends_on ?? []) {
      const list = dependents.get(parent) ?? [];
      list.push(node.id);
      dependents.set(parent, list);
    }
  }

  function isReady(node) {
    for (const dep of node.depends_on ?? []) {
      if (statuses[dep] !== "success") return false;
    }
    return true;
  }

  function markFailure(nodeId, error, policy) {
    if (policy === "skip") {
      statuses[nodeId] = "skipped";
      onEvent({ type: "node_failed", node_id: nodeId, policy, error: error?.message });
      cascadeBlock(nodeId);
      return;
    }
    statuses[nodeId] = "failed";
    if (!failedNodeId) {
      failedNodeId = nodeId;
      failure = { message: error?.message ?? String(error), policy };
    }
    onEvent({
      type: policy === "replan" ? "replan_requested" : "node_failed",
      node_id: nodeId,
      policy,
      error: error?.message ?? String(error)
    });
    cascadeBlock(nodeId);
  }

  function cascadeBlock(startId) {
    // Any descendant that's still pending gets marked blocked.
    const queue = [...childrenOf(startId)];
    while (queue.length) {
      const id = queue.shift();
      if (statuses[id]) continue;
      statuses[id] = "blocked";
      onEvent({ type: "node_blocked", node_id: id, blocked_by: startId });
      queue.push(...childrenOf(id));
    }
  }

  async function runOne(node) {
    let resolvedParams;
    try {
      resolvedParams = resolveParams(node.params ?? {}, results);
    } catch (error) {
      if (error instanceof PlaceholderUnresolvedError) {
        markFailure(node.id, error, "placeholder_unresolved");
        return;
      }
      throw error;
    }

    const { policy, arg } = parseOnFailure(node);
    const maxRetries = node.retry_policy?.max ?? (policy === "retry" ? (arg ?? 1) : 0);
    const backoffMs = node.retry_policy?.backoff_ms ?? 500;

    let attempt = 0;
    let lastError = null;
    while (attempt <= maxRetries) {
      attempt += 1;
      statuses[node.id] = "running";
      onEvent({ type: "node_started", node_id: node.id, kind: node.kind, attempt });
      try {
        const result = await dispatchNode(node, resolvedParams, { results, statuses });
        results[node.id] = result;
        statuses[node.id] = "success";
        onEvent({ type: "node_succeeded", node_id: node.id, kind: node.kind });
        return;
      } catch (error) {
        lastError = error;
        onEvent({
          type: "node_attempt_failed",
          node_id: node.id,
          attempt,
          will_retry: attempt <= maxRetries,
          error: error?.message ?? String(error)
        });
        if (attempt <= maxRetries && backoffMs > 0) {
          await new Promise((r) => setTimeout(r, backoffMs * attempt));
        }
      }
    }
    markFailure(node.id, lastError, policy);
  }

  function scheduleNode(node) {
    if (node.concurrency === "serial_per_session" && typeof node.session_key === "string") {
      let key = node.session_key;
      try {
        const resolved = resolveParams(node.session_key, results);
        if (typeof resolved === "string") key = resolved;
      } catch { /* fall back to template */ }
      let bucket = serialBuckets.get(key);
      if (!bucket) {
        bucket = { busy: false, queue: [] };
        serialBuckets.set(key, bucket);
      }
      bucket.queue.push(node);
      drainBucket(key);
    } else {
      const promise = runOne(node).finally(() => {
        inFlight.delete(node.id);
        dispatcherPass();
      });
      inFlight.set(node.id, promise);
    }
  }

  function drainBucket(key) {
    const bucket = serialBuckets.get(key);
    if (!bucket || bucket.busy) return;
    const next = bucket.queue.shift();
    if (!next) return;
    bucket.busy = true;
    const promise = runOne(next).finally(() => {
      inFlight.delete(next.id);
      bucket.busy = false;
      drainBucket(key);
      dispatcherPass();
    });
    inFlight.set(next.id, promise);
  }

  function dispatcherPass() {
    if (failedNodeId) {
      maybeResolveFlush();
      return;
    }
    for (const node of nodesById.values()) {
      if (statuses[node.id]) continue;
      if (inFlight.has(node.id)) continue;
      if (!isReady(node)) continue;
      // Ready: dispatch.
      scheduleNode(node);
    }
    maybeResolveFlush();
  }

  function maybeResolveFlush() {
    if (!streamClosed) return;
    if (inFlight.size > 0) return;
    // Check all nodes have terminal status (success / failed / skipped /
    // blocked). Anything still undefined means its deps never arrived →
    // treat as blocked.
    for (const node of nodesById.values()) {
      if (!statuses[node.id]) {
        statuses[node.id] = "blocked";
        onEvent({ type: "node_blocked", node_id: node.id, blocked_by: "stream_ended_before_deps_arrived" });
      }
    }
    const status = failedNodeId ? "failed" : "success";
    onEvent({ type: "plan_finished", status, failed_node_id: failedNodeId });
    flushResolve?.({ status, results, statuses, failedNodeId, failure });
    flushResolve = null;
  }

  return {
    addNode(node) {
      if (!node || typeof node.id !== "string" || !node.id.trim()) {
        onEvent({ type: "plan_node_rejected", reason: "missing_id", node });
        return;
      }
      if (nodesById.has(node.id)) {
        onEvent({ type: "plan_node_rejected", reason: "duplicate_id", node_id: node.id });
        return;
      }
      nodesById.set(node.id, node);
      registerEdges(node);
      onEvent({ type: "plan_node_received", node_id: node.id, kind: node.kind });
      dispatcherPass();
    },
    async flush() {
      streamClosed = true;
      onEvent({ type: "plan_streaming_finished", node_count: nodesById.size });
      // If nothing was ever in flight or any running finish kicks dispatcherPass,
      // we still need to nudge once here for the zero-node edge case.
      dispatcherPass();
      return flushPromise;
    }
  };
}
