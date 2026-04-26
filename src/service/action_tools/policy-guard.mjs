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
  const policy = task?.task_spec?.tool_policy?.[toolId];
  if (policy && policy.mode === "forbidden") {
    if (runtime) {
      try {
        appendAuditLog(runtime, "tool.blocked_by_policy", {
          tool_id: toolId,
          reason: policy.reason ?? "tool_policy.mode === forbidden",
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
        metadata: { tool_id: toolId, policy_mode: "forbidden", policy_reason: policy.reason ?? null }
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
