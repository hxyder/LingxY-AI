/**
 * UCA-077 P4-04: Tool-policy guard.
 *
 * Two enforcement layers consumed by `registry.call()`:
 *
 *   1. Forbidden enforcement — when `task.task_spec.tool_policy.<toolId>.mode
 *      === "forbidden"`, block execution and audit. The plan / agentic
 *      prompt-builder already TELL the LLM to respect forbidden, but until
 *      this guard existed nothing actually stopped a misbehaving model from
 *      calling the tool anyway.
 *
 *   2. Per-task rate limit — write-side and externally-billed tools get a
 *      hard cap per task to prevent runaway loops or accidental billing
 *      explosions. Default caps live here; a TaskSpec may override via
 *      `task.task_spec.execution_constraints.rate_limit` (Phase 4 future).
 *
 * The guard is intentionally pure-function-shaped. State (counters) lives
 * on the runtime singleton via `runtime.perTaskToolCallCounts` so it
 * survives cross-call recovery without a dedicated store.
 */

import { appendAuditLog } from "../security/audit-log.mjs";
import { groupsOfTool } from "../core/policy/policy-groups.mjs";
import { createActionResult } from "./types.mjs";

/**
 * Per-task call caps. Tools missing from this table have no cap.
 *
 * The numbers are intentionally low for write-side / external-billed tools;
 * read-side and local tools are unconstrained because they cannot fan out
 * to a third party. Override via task.task_spec.execution_constraints.
 */
const DEFAULT_RATE_LIMITS = Object.freeze({
  web_search_fetch: 5,
  fetch_url_content: 8,
  connector_workflow_run: 3,
  generate_document: 2,
  edit_file: 4,
  write_file: 6,
  run_script: 4
});

/**
 * @typedef {{ allowed: true } | { allowed: false, result: import("./types.mjs").ActionResult }} GuardOutcome
 */

/**
 * Pre-execution guard. Returns either `{ allowed: true }` (proceed to call
 * tool.execute) or `{ allowed: false, result }` (registry returns this
 * shaped failure to the executor).
 *
 * Side effects: increments runtime.perTaskToolCallCounts; writes audit log
 * entries when blocking. Both side effects are intentional — the caller
 * should NOT call this twice for the same logical invocation.
 *
 * @param {string} toolId
 * @param {object} args
 * @param {object} ctx
 * @returns {GuardOutcome}
 */
export function applyPolicyGuard(toolId, args, ctx) {
  const task = ctx?.task ?? null;
  const runtime = ctx?.runtime ?? null;
  const taskId = task?.task_id ?? null;

  // 1. Forbidden enforcement.
  //
  // Two-layer check, in priority order:
  //   1a. Direct toolId entry — `tool_policy[toolId].mode === "forbidden"`.
  //       This is what the resolver expands to for back-compat.
  //   1b. Policy-group entry — `tool_policy.policy_groups[group].mode ===
  //       "forbidden"` for any group this toolId belongs to. Defense in
  //       depth (P4-00 / Issue β): if a future caller — including
  //       SemanticRouter or a manually constructed TaskSpec — emits ONLY a
  //       group-level decision, the guard still catches sibling tools that
  //       share the group. This is the wall that closes the
  //       `web_search_fetch` blocked → `web_search` succeeds bypass.
  const blockingPolicy = findForbiddingPolicy(task?.task_spec?.tool_policy, toolId);
  if (blockingPolicy) {
    const { policy, source } = blockingPolicy;
    if (runtime) {
      try {
        appendAuditLog(runtime, "tool.blocked_by_policy", {
          tool_id: toolId,
          reason: policy.reason ?? "tool_policy.mode === forbidden",
          policy_source: source,           // "tool" | "group:<groupId>"
          args_summary: summariseArgs(args)
        }, taskId);
      } catch { /* audit failure must not break tool execution */ }
    }
    return {
      allowed: false,
      result: createActionResult({
        success: false,
        observation: `Tool "${toolId}" is forbidden by task policy: ${policy.reason ?? "no reason given"}`,
        error: "blocked_by_policy",
        metadata: {
          tool_id: toolId,
          policy_mode: "forbidden",
          policy_reason: policy.reason ?? null,
          policy_source: source
        }
      })
    };
  }

  // 2. Per-task rate limit. We need a runtime AND a taskId; otherwise we
  //    cannot maintain a counter (e.g. unit tests that pass a bare ctx).
  const limit = resolveRateLimit(toolId, task);
  if (limit !== null && runtime && taskId) {
    const counts = ensureRuntimeCounter(runtime);
    const key = `${taskId}:${toolId}`;
    const used = counts.get(key) ?? 0;

    if (used >= limit) {
      try {
        appendAuditLog(runtime, "tool.rate_limited", {
          tool_id: toolId,
          limit,
          used,
          args_summary: summariseArgs(args)
        }, taskId);
      } catch { /* audit failure must not break tool execution */ }
      return {
        allowed: false,
        result: createActionResult({
          success: false,
          observation: `Rate limit exceeded for "${toolId}" (${used}/${limit} per task). Further calls will keep returning this error until the task ends.`,
          error: "rate_limited",
          metadata: { tool_id: toolId, limit, used }
        })
      };
    }

    counts.set(key, used + 1);
  }

  return { allowed: true };
}

/**
 * Test helper — reset all counters for a runtime. Production code never
 * calls this; counters are bound to runtime lifetime.
 */
export function resetRateLimits(runtime) {
  if (runtime?.perTaskToolCallCounts instanceof Map) {
    runtime.perTaskToolCallCounts.clear();
  }
}

/**
 * Test/admin helper — read current count for a (taskId, toolId) pair.
 * @returns {number}
 */
export function getRateLimitUsage(runtime, taskId, toolId) {
  return runtime?.perTaskToolCallCounts?.get(`${taskId}:${toolId}`) ?? 0;
}

/**
 * Look for a `forbidden` decision that applies to `toolId`. Returns the
 * policy object plus a tag identifying which layer it came from, or null
 * when no layer forbids the tool.
 *
 * @param {object|null|undefined} toolPolicy   `task.task_spec.tool_policy`
 * @param {string} toolId
 * @returns {{ policy: object, source: string } | null}
 */
function findForbiddingPolicy(toolPolicy, toolId) {
  if (!toolPolicy || typeof toolPolicy !== "object") return null;

  const direct = toolPolicy[toolId];
  if (direct && direct.mode === "forbidden") {
    return { policy: direct, source: "tool" };
  }

  const groupEntries = toolPolicy.policy_groups;
  if (groupEntries && typeof groupEntries === "object") {
    for (const group of groupsOfTool(toolId)) {
      const groupPolicy = groupEntries[group];
      if (groupPolicy && groupPolicy.mode === "forbidden") {
        return { policy: groupPolicy, source: `group:${group}` };
      }
    }
  }

  return null;
}

function resolveRateLimit(toolId, task) {
  const taskOverride = task?.task_spec?.execution_constraints?.rate_limit?.[toolId];
  if (typeof taskOverride === "number" && taskOverride >= 0) return taskOverride;
  if (toolId in DEFAULT_RATE_LIMITS) return DEFAULT_RATE_LIMITS[toolId];
  return null;
}

function ensureRuntimeCounter(runtime) {
  if (!(runtime.perTaskToolCallCounts instanceof Map)) {
    runtime.perTaskToolCallCounts = new Map();
  }
  return runtime.perTaskToolCallCounts;
}

function summariseArgs(args) {
  if (!args || typeof args !== "object") return null;
  const summary = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      summary[k] = v.length > 80 ? v.slice(0, 77) + "..." : v;
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      summary[k] = v;
    } else if (Array.isArray(v)) {
      summary[k] = `[array length=${v.length}]`;
    } else {
      summary[k] = `[${typeof v}]`;
    }
  }
  return summary;
}

export { DEFAULT_RATE_LIMITS };
