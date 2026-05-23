/**
 * UCA-077 P4-00.6 (plan §18.2.2): tool_policy invariant enforcement.
 *
 * The resolver and the connector-domain branch in createTaskSpec both
 * emit a *consistent* tool_policy via `buildExternalWebReadPolicy` —
 * group entry and every per-toolId entry carry the same mode/reason. So
 * today this invariant is trivially satisfied; the helper acts as a
 * forward-compatibility safety net for write paths that come later:
 *
 *   - Phase 4 SemanticRouter (P4-02 / P4-03): may emit a per-tool
 *     override without touching the matching group, or vice versa.
 *   - External callers / tests that hand-build a tool_policy.
 *
 * Resolution rule: when a per-toolId entry disagrees with its group
 * entry, **forbidden wins** (security-conservative). When neither side
 * is forbidden but the modes still differ (e.g. group=optional but
 * toolId=required from a SemanticRouter override), the **group entry is
 * canonical** and the per-toolId mode is rewritten to match — the group
 * is the policy unit, the toolId is a back-compat projection.
 *
 * Every resolution is recorded as a conflict event so DecisionTrace can
 * surface it. The function does NOT throw — it always returns a usable
 * policy. We treat the conflict as a recoverable inconsistency, not a
 * crash condition, because the upstream code path (a misbehaving Phase 4
 * router) is exactly the case we want this to defend.
 */

import { toolsInGroup } from "./policy-groups.mjs";

/**
 * @typedef {Object} PolicyConflictEvent
 * @property {string} group
 * @property {string} tool_id
 * @property {string} group_mode
 * @property {string} tool_mode
 * @property {string} resolution      // the mode the resolver chose
 * @property {"forbidden-wins"|"group-canonical"} reason
 */

/**
 * @param {object} toolPolicy   `task_spec.tool_policy`
 * @returns {{ resolved: object, conflicts: PolicyConflictEvent[] }}
 */
export function enforcePolicyInvariants(toolPolicy) {
  if (!toolPolicy || typeof toolPolicy !== "object") {
    return { resolved: toolPolicy, conflicts: [] };
  }
  const groupEntries = toolPolicy.policy_groups;
  if (!groupEntries || typeof groupEntries !== "object" || Object.keys(groupEntries).length === 0) {
    return { resolved: toolPolicy, conflicts: [] };
  }

  /** @type {PolicyConflictEvent[]} */
  const conflicts = [];
  // Shallow copy + rebuild policy_groups so mutations do not leak into
  // the caller's input (resolver output, SemanticRouter cache, etc.).
  const resolved = { ...toolPolicy, policy_groups: { ...groupEntries } };

  for (const [group, groupDecision] of Object.entries(groupEntries)) {
    if (!groupDecision || typeof groupDecision !== "object" || !groupDecision.mode) continue;
    const members = toolsInGroup(group);
    for (const toolId of members) {
      const toolDecision = resolved[toolId];
      if (!toolDecision || typeof toolDecision !== "object" || !toolDecision.mode) continue;
      if (toolDecision.mode === groupDecision.mode) continue;

      const { mode: winnerMode, reason } = resolveConflict(groupDecision.mode, toolDecision.mode);
      const note = `Conflict on policy group "${group}": group=${groupDecision.mode} vs ${toolId}=${toolDecision.mode}. ${reasonText(reason)} → ${winnerMode}.`;

      conflicts.push({
        group,
        tool_id: toolId,
        group_mode: groupDecision.mode,
        tool_mode: toolDecision.mode,
        resolution: winnerMode,
        reason
      });

      // Rewrite both views to the same mode so downstream consumers that
      // read either side land on the same answer. Mark the entries so a
      // UI can label "this was overridden" instead of trusting the value
      // verbatim. The original mode is preserved in policy_conflict_from
      // for audit / debugging.
      const baseEntry = winnerMode === groupDecision.mode
        ? groupDecision
        : toolDecision;
      const stamped = {
        ...baseEntry,
        mode: winnerMode,
        policy_conflict: true,
        policy_conflict_reason: note,
        policy_conflict_from: {
          group_mode: groupDecision.mode,
          tool_mode: toolDecision.mode
        }
      };
      resolved[toolId] = stamped;
      resolved.policy_groups[group] = stamped;
    }
  }
  return { resolved, conflicts };
}

/**
 * @param {string} groupMode
 * @param {string} toolMode
 * @returns {{ mode: string, reason: "forbidden-wins"|"group-canonical" }}
 */
function resolveConflict(groupMode, toolMode) {
  // Forbidden never loses. If either side is forbidden, the resolved
  // mode is forbidden — the entire group becomes off-limits and the
  // registry guard already enforces that for every member tool.
  if (groupMode === "forbidden" || toolMode === "forbidden") {
    return { mode: "forbidden", reason: "forbidden-wins" };
  }
  // No forbidden involved (e.g. group=optional vs tool=required, or
  // group=required vs tool=optional). The group entry is the canonical
  // unit of policy — the per-toolId views are projections — so we
  // rewrite the tool entry to match the group. We log this so the
  // operator can see that SemanticRouter's per-tool nudge was overruled.
  return { mode: groupMode, reason: "group-canonical" };
}

function reasonText(reason) {
  return reason === "forbidden-wins"
    ? "forbidden wins (security-conservative)"
    : "group entry is canonical";
}
