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

function topoOrder(plan) {
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
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const child of children.get(id)) {
      indeg.set(child, indeg.get(child) - 1);
      if (indeg.get(child) === 0) queue.push(child);
    }
  }
  return order;
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
  onEvent = () => {}
}) {
  const validation = validateDagPlan(plan);
  if (!validation.ok) {
    throw new Error(`invalid plan: ${validation.errors.join("; ")}`);
  }

  const order = topoOrder(plan);
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const results = {};
  const statuses = {};
  let failedNodeId = null;
  let failure = null;

  onEvent({ type: "plan_started", plan_summary: plan.summary ?? null, node_count: plan.nodes.length });

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;

    // Any dependency failed → block this node.
    const unmet = (node.depends_on ?? []).find((dep) => statuses[dep] !== "success");
    if (unmet) {
      statuses[id] = "blocked";
      onEvent({ type: "node_blocked", node_id: id, blocked_by: unmet });
      continue;
    }

    let resolvedParams;
    try {
      resolvedParams = resolveParams(node.params ?? {}, results);
    } catch (error) {
      if (error instanceof PlaceholderUnresolvedError) {
        statuses[id] = "failed";
        failedNodeId = id;
        failure = { message: error.message, policy: "placeholder_unresolved" };
        onEvent({ type: "node_failed", node_id: id, error: error.message, phase: "placeholder" });
        break;
      }
      throw error;
    }

    const { policy, arg } = parseOnFailure(node);
    const maxRetries = node.retry_policy?.max ?? (policy === "retry" ? (arg ?? 1) : 0);
    const backoffMs = node.retry_policy?.backoff_ms ?? 500;

    let attempt = 0;
    let lastError = null;
    let succeeded = false;

    while (attempt <= maxRetries) {
      attempt += 1;
      statuses[id] = "running";
      onEvent({ type: "node_started", node_id: id, kind: node.kind, attempt });
      try {
        const result = await dispatchNode(node, resolvedParams, { results, statuses, context });
        results[id] = result;
        statuses[id] = "success";
        onEvent({ type: "node_succeeded", node_id: id, kind: node.kind });
        succeeded = true;
        break;
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

    if (!succeeded) {
      statuses[id] = policy === "skip" ? "skipped" : "failed";
      onEvent({
        type: "node_failed",
        node_id: id,
        kind: node.kind,
        error: lastError?.message ?? String(lastError ?? "unknown"),
        policy
      });

      if (policy === "skip") {
        continue;
      }
      if (policy === "replan") {
        // Signal to the caller; Phase 4 will plug in a replan hook here.
        failedNodeId = id;
        failure = { message: lastError?.message ?? "replan_requested", policy };
        onEvent({ type: "replan_requested", node_id: id });
        break;
      }
      failedNodeId = id;
      failure = { message: lastError?.message ?? "node_failed", policy };
      break;
    }
  }

  const status = failedNodeId ? "failed" : "success";
  onEvent({ type: "plan_finished", status, failed_node_id: failedNodeId });
  return { status, results, statuses, failedNodeId, failure };
}
