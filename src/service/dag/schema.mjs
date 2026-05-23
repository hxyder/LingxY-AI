/**
 * DAG plan schema — the JSON shape the planner LLM emits and the DAG engine
 * consumes. Phase 1 infrastructure: defines node kinds, validates structure,
 * detects cycles, and catches obvious planner mistakes before execution.
 *
 * A plan looks like:
 * {
 *   "summary": "short natural-language summary (user-facing)",
 *   "nodes": [
 *     {
 *       "id": "<unique>",
 *       "kind": "mcp_tool" | "action_tool" | "workflow" | "skill" | "agent_loop",
 *       "tool"?: "<tool_id>",        // required for *_tool kinds
 *       "workflowId"?: "<id>",       // required for "workflow" kind
 *       "skill"?: "<skill_id>",      // required for "skill" kind
 *       "params": { … },             // may contain {{nodeId.path}} placeholders
 *       "depends_on"?: ["<nodeId>"], // topo edges
 *       "concurrency"?: "parallel_safe" | "serial_per_session",
 *       "session_key"?: "<template>",  // only for serial_per_session
 *       "timeout_ms"?: number,
 *       "retry_policy"?: { "max": number, "backoff_ms": number },
 *       "on_failure"?: "retry" | "skip" | "fail" | "replan"
 *     }
 *   ]
 * }
 *
 * No Turing-complete expressions — placeholder resolution is pure lookup.
 * Complex transforms belong inside `agent_loop` nodes.
 */

export const NODE_KINDS = Object.freeze([
  "mcp_tool",     // invoke an MCP server tool via catalog bridge
  "action_tool",  // invoke a local action tool from the registry
  "workflow",     // run a connector workflow via workflow-dispatcher
  "skill",        // run a stateful Skill (Phase 6 runtime)
  "agent_loop"    // nested single-turn agent-loop (for sub-reasoning steps)
]);

export const CONCURRENCY_POLICIES = Object.freeze([
  "parallel_safe",       // default for MCP / action_tool
  "serial_per_session"   // default for skill
]);

export const FAILURE_POLICIES = Object.freeze([
  "retry",
  "skip",
  "fail",
  "replan"
]);

// Placeholder form: {{nodeId}} or {{nodeId.dotted.path}} or {{nodeId.array[0].x}}.
// Lookaround-free so the same regex works for match + test.
export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*)\s*\}\}/g;

/**
 * Walk a value (object/array/string) and emit every placeholder reference
 * it contains. Used by the schema validator to confirm placeholders point
 * at real nodes before execution starts.
 */
export function* iterPlaceholderRefs(value) {
  if (typeof value === "string") {
    const matches = value.matchAll(PLACEHOLDER_RE);
    for (const m of matches) {
      const head = m[1].split(/[.[]/, 1)[0];
      yield { raw: m[0], path: m[1], nodeId: head };
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* iterPlaceholderRefs(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) yield* iterPlaceholderRefs(v);
  }
}

function requiredFieldFor(kind) {
  if (kind === "mcp_tool" || kind === "action_tool") return "tool";
  if (kind === "workflow") return "workflowId";
  if (kind === "skill") return "skill";
  return null; // agent_loop uses params.userCommand
}

function detectCycle(nodeIds, edges) {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const out = new Map(nodeIds.map((id) => [id, []]));
  for (const { from, to } of edges) {
    if (!indegree.has(to) || !out.has(from)) continue;
    indegree.set(to, indegree.get(to) + 1);
    out.get(from).push(to);
  }
  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const next of out.get(id) ?? []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return visited !== nodeIds.length;
}

/**
 * Validate a DAG plan. Returns {ok:true, edges} or {ok:false, errors:[]}.
 * edges is the derived adjacency list for later use by the scheduler.
 *
 * `knownExternalIds` lets callers declare node ids that exist in pre-seeded
 * context (e.g. a replan with already-completed upstream nodes) — the
 * validator treats placeholders referring to those ids as valid even
 * though the ids aren't in plan.nodes.
 */
export function validateDagPlan(plan, { knownExternalIds = [] } = {}) {
  const external = new Set(knownExternalIds);
  const errors = [];
  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["plan is not an object"] };
  }
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : null;
  if (!nodes || nodes.length === 0) {
    return { ok: false, errors: ["plan.nodes must be a non-empty array"] };
  }

  const ids = new Set();
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      errors.push("node is not an object");
      continue;
    }
    if (typeof node.id !== "string" || !node.id.trim()) {
      errors.push("node.id must be a non-empty string");
      continue;
    }
    if (ids.has(node.id)) {
      errors.push(`duplicate node.id: ${node.id}`);
    }
    ids.add(node.id);

    if (!NODE_KINDS.includes(node.kind)) {
      errors.push(`node ${node.id}: unknown kind "${node.kind}"; expected one of ${NODE_KINDS.join(" | ")}`);
      continue;
    }
    const required = requiredFieldFor(node.kind);
    if (required && (typeof node[required] !== "string" || !node[required].trim())) {
      errors.push(`node ${node.id} (kind=${node.kind}): missing required field "${required}"`);
    }
    if (node.kind === "agent_loop"
      && (typeof node.params?.userCommand !== "string" || !node.params.userCommand.trim())) {
      errors.push(`node ${node.id} (kind=agent_loop): params.userCommand is required`);
    }

    if (node.concurrency && !CONCURRENCY_POLICIES.includes(node.concurrency)) {
      errors.push(`node ${node.id}: unknown concurrency "${node.concurrency}"`);
    }
    if (node.on_failure && !FAILURE_POLICIES.includes(node.on_failure.split(":")[0])) {
      errors.push(`node ${node.id}: unknown on_failure "${node.on_failure}"`);
    }
    if (node.concurrency === "serial_per_session"
      && (typeof node.session_key !== "string" || !node.session_key.trim())) {
      errors.push(`node ${node.id}: concurrency=serial_per_session requires session_key`);
    }
  }

  const edges = [];
  for (const node of nodes) {
    if (!node?.id) continue;
    for (const from of node.depends_on ?? []) {
      if (!ids.has(from) && !external.has(from)) {
        errors.push(`node ${node.id}: depends_on references unknown node "${from}"`);
        continue;
      }
      if (ids.has(from)) {
        edges.push({ from, to: node.id });
      }
      // If `from` is external, it's already complete by assumption —
      // no edge to add because the topological sort operates only on
      // plan.nodes.
    }
    for (const { nodeId, raw } of iterPlaceholderRefs(node.params)) {
      if (!ids.has(nodeId) && !external.has(nodeId)) {
        errors.push(`node ${node.id}: placeholder ${raw} references unknown node "${nodeId}"`);
      }
    }
  }

  if (errors.length === 0 && detectCycle([...ids], edges)) {
    errors.push("plan contains a cycle in depends_on");
  }

  return errors.length === 0
    ? { ok: true, edges }
    : { ok: false, errors };
}
