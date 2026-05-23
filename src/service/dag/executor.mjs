/**
 * DAG Executor — runs a validated DAG plan.
 *
 * Phase 2: serial topo-order execution. Placeholder resolution happens per
 * node right before dispatch; failed placeholder resolution is a node-level
 * failure that respects on_failure policy. A dispatchNode callback owns
 * the actual tool/workflow/agent invocation so this module stays free of
 * Layer 4 concerns.
 *
 * Phase 3 will upgrade the loop to layer-by-layer Promise.all with
 * concurrency-policy grouping.
 * Phase 4 will wire replan hooks into the failure path.
 */

import { validateDagPlan } from "./schema.mjs";
import { resolveParams, PlaceholderUnresolvedError } from "./placeholder.mjs";

/**
 * Kahn's algorithm but grouped into LAYERS — each layer contains every
 * node whose dependencies are all satisfied by previous layers. Nodes in
 * the same layer can run concurrently (subject to per-node concurrency
 * policy). Returns [[idA, idB], [idC], [idD, idE, idF]] style list.
 */
function topoLayers(plan) {
  const ids = plan.nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const children = new Map(ids.map((id) => [id, []]));
  for (const node of plan.nodes) {
    for (const parent of node.depends_on ?? []) {
      if (!indeg.has(parent)) continue;
      indeg.set(node.id, (indeg.get(node.id) ?? 0) + 1);
      children.get(parent).push(node.id);
    }
  }
  const layers = [];
  let frontier = ids.filter((id) => indeg.get(id) === 0);
  while (frontier.length) {
    layers.push(frontier);
    const nextFrontier = [];
    for (const id of frontier) {
      for (const child of children.get(id)) {
        indeg.set(child, indeg.get(child) - 1);
        if (indeg.get(child) === 0) nextFrontier.push(child);
      }
    }
    frontier = nextFrontier;
  }
  return layers;
}

function parseOnFailure(node) {
  const raw = String(node.on_failure ?? "fail");
  const [policy, argStr = ""] = raw.split(":");
  const arg = Number(argStr);
  return { policy, arg: Number.isFinite(arg) ? arg : null };
}

/**
 * Execute a DAG plan. dispatchNode(node, resolvedParams, context) must
 * return the node's result value (any JSON-serialisable shape). Events
 * are emitted via onEvent for the UI timeline.
 *
 * Returns a snapshot:
 *   {
 *     status: "success" | "failed",
 *     results: { [nodeId]: value },
 *     statuses: { [nodeId]: "success" | "failed" | "skipped" | "blocked" },
 *     failedNodeId: string | null,
 *     failure: { message, policy } | null
 *   }
 */
export async function runDagPlan({
  plan,
  dispatchNode,
  context = {},
  onEvent = () => {},
  // Seeded upstream results from a previous (e.g. pre-replan) run. Their
  // ids become available as placeholder lookups for the new plan's nodes,
  // so a replan can say {{original_s3.result.foo}} without re-executing.
  seededResults = null
}) {
  const seeded = { ...(seededResults ?? context?.seededResults ?? {}) };
  const validation = validateDagPlan(plan, {
    knownExternalIds: Object.keys(seeded)
  });
  if (!validation.ok) {
    throw new Error(`invalid plan: ${validation.errors.join("; ")}`);
  }

  const layers = topoLayers(plan);
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const results = { ...seeded };
  const statuses = {};
  for (const id of Object.keys(results)) {
    // Seeded nodes count as already-successful so downstream depends_on
    // checks pass. They're NOT re-executed.
    statuses[id] = "success";
  }
  let failedNodeId = null;
  let failure = null;

  onEvent({
    type: "plan_started",
    plan_summary: plan.summary ?? null,
    node_count: plan.nodes.length,
    layer_count: layers.length
  });

  // Executes a single node with retry + policy handling. Returns an object
  // describing the outcome; does NOT throw. This runs inside Promise.all
  // so siblings in the same layer are independent.
  async function runOne(id) {
    const node = byId.get(id);
    if (!node) return { id, outcome: "unknown" };

    const unmet = (node.depends_on ?? []).find((dep) => statuses[dep] !== "success");
    if (unmet) {
      statuses[id] = "blocked";
      onEvent({ type: "node_blocked", node_id: id, blocked_by: unmet });
      return { id, outcome: "blocked" };
    }

    let resolvedParams;
    try {
      resolvedParams = resolveParams(node.params ?? {}, results);
    } catch (error) {
      if (error instanceof PlaceholderUnresolvedError) {
        statuses[id] = "failed";
        onEvent({ type: "node_failed", node_id: id, error: error.message, phase: "placeholder" });
        return { id, outcome: "failed", policy: "placeholder_unresolved", error };
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
      statuses[id] = "running";
      onEvent({ type: "node_started", node_id: id, kind: node.kind, attempt });
      try {
        const result = await dispatchNode(node, resolvedParams, { results, statuses, context });
        results[id] = result;
        statuses[id] = "success";
        onEvent({ type: "node_succeeded", node_id: id, kind: node.kind });
        return { id, outcome: "success" };
      } catch (error) {
        lastError = error;
        onEvent({
          type: "node_attempt_failed",
          node_id: id,
          kind: node.kind,
          attempt,
          will_retry: attempt <= maxRetries,
          error: error?.message ?? String(error)
        });
        if (attempt <= maxRetries && backoffMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
        }
      }
    }

    // All retries exhausted.
    statuses[id] = policy === "skip" ? "skipped" : "failed";
    onEvent({
      type: policy === "replan" ? "replan_requested" : "node_failed",
      node_id: id,
      kind: node.kind,
      error: lastError?.message ?? String(lastError ?? "unknown"),
      policy
    });
    return { id, outcome: policy === "skip" ? "skipped" : "failed", policy, error: lastError };
  }

  // Within a single layer, group by concurrency policy:
  //  - parallel_safe  → all run concurrently via Promise.all
  //  - serial_per_session → bucket by resolved session_key, each bucket
  //    serial internally, buckets parallel with each other
  function bucketLayer(layer) {
    const parallelIds = [];
    const serialBuckets = new Map(); // sessionKey -> [ids]
    for (const id of layer) {
      const node = byId.get(id);
      if (!node) continue;
      if (node.concurrency === "serial_per_session" && typeof node.session_key === "string") {
        // session_key may contain {{...}} placeholders — resolve now so
        // each node's bucket reflects its actual session.
        let key = node.session_key;
        try {
          const resolved = resolveParams(node.session_key, results);
          if (typeof resolved === "string") key = resolved;
        } catch { /* fall back to template string */ }
        const list = serialBuckets.get(key) ?? [];
        list.push(id);
        serialBuckets.set(key, list);
      } else {
        parallelIds.push(id);
      }
    }
    return { parallelIds, serialBuckets };
  }

  for (const layer of layers) {
    if (failedNodeId) break;
    const { parallelIds, serialBuckets } = bucketLayer(layer);

    const parallelPromises = parallelIds.map((id) => runOne(id));
    const serialPromises = [...serialBuckets.values()].map(async (idsInBucket) => {
      const outs = [];
      for (const id of idsInBucket) {
        outs.push(await runOne(id));
      }
      return outs;
    });

    const results_ = await Promise.all([...parallelPromises, ...serialPromises]);
    const flat = results_.flat();
    for (const r of flat) {
      if (r.outcome === "failed") {
        if (r.policy === "replan") {
          failedNodeId = r.id;
          failure = { message: r.error?.message ?? "replan_requested", policy: "replan" };
        } else if (r.policy === "fail" || r.policy === "placeholder_unresolved"
          || (!r.policy || r.policy === "retry")) {
          failedNodeId = failedNodeId ?? r.id;
          failure = failure ?? {
            message: r.error?.message ?? "node_failed",
            policy: r.policy ?? "fail"
          };
        }
      }
    }
  }

  const status = failedNodeId ? "failed" : "success";
  onEvent({ type: "plan_finished", status, failed_node_id: failedNodeId });
  return { status, results, statuses, failedNodeId, failure };
}
