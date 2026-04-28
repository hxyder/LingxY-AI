import { appendAuditLog } from "../security/audit-log.mjs";
import { groupsOfTool } from "../core/policy/policy-groups.mjs";
import { createActionResult } from "./types.mjs";

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
        observation: `Tool "${toolId}" needs user permission under the current task contract: ${policy.reason ?? "no reason given"}. Ask the user for permission before retrying.`,
        error: "blocked_by_policy",
        metadata: {
          tool_id: toolId,
          policy_mode: "forbidden",
          policy_reason: policy.reason ?? null,
          policy_source: source,
          requires_user_permission: true
        }
      })
    };
  }

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
