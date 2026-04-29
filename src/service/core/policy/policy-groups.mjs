/**
 * UCA-077 P4-00: Canonical policy-group membership.
 *
 * A policy group bundles every tool that fulfils the same intent (e.g. "read
 * something off the open web"). When `tool-policy-resolver` decides that a
 * task forbids "external web reading", the decision must apply to ALL tools
 * in the group — otherwise the LLM trivially bypasses the wall by switching
 * to a synonymous tool. That symptom (β / RR-03 in plan §14.2) was observed
 * with `web_search_fetch` blocked but `web_search` (a sibling that opens a
 * Google URL) succeeding.
 *
 * Single source of truth: both the resolver (which expands a group decision
 * to per-toolId entries for back-compat consumers) and the registry-level
 * policy guard (which performs group-level forbidden checks as defense in
 * depth) read this file. Tool definitions also echo `policy_group` for
 * locality, but membership here is the binding answer.
 */

export const POLICY_GROUPS = Object.freeze({
  /**
   * Tools that retrieve content from the open web. Excludes `open_url`:
   * that primitive is dual-use (mailto:, file:///, internal artifact URLs)
   * and over-blocking it would damage benign local flows. If a future task
   * needs to forbid arbitrary URL navigation, introduce a separate
   * `external_web_navigate` group rather than overloading this one.
   */
  external_web_read: Object.freeze([
    "web_search",
    "web_search_fetch",
    "fetch_url_content"
  ]),

  /**
   * Tools/workflows that actually send email. Draft-only helpers are excluded:
   * a user-visible "sent" contract should be satisfied only by a delivery
   * path, or by a connector workflow whose metadata reports success.
   */
  email_send: Object.freeze([
    "account_send_email",
    "send_email_smtp",
    "connector_workflow_run",
    "google.gmail.send_email",
    "microsoft.outlook.send_email"
  ]),

  /**
   * Tools/workflows that create a real calendar event. Draft / preview helpers
   * are excluded; connector workflows count only when their metadata says the
   * matching calendar workflow completed.
   */
  calendar_create: Object.freeze([
    "account_create_event",
    "connector_workflow_run",
    "google.calendar.create_event",
    "microsoft.calendar.create_event"
  ]),

  /**
   * Tools that upload a local file into a connected cloud-drive account.
   */
  file_upload: Object.freeze([
    "account_upload_file",
    "google.drive.upload_file",
    "microsoft.onedrive.upload_file"
  ]),

  /**
   * Tools that persist a schedule (cron / at / interval / natural-language
   * trigger). Satisfied only when the schedule is actually created — a
   * model finalizing with "已设置好提醒" without calling the tool fails
   * the action-claim guard.
   */
  schedule_create: Object.freeze([
    "create_scheduled_task"
  ])
});

/**
 * @param {string} group
 * @returns {readonly string[]}
 */
export function toolsInGroup(group) {
  return POLICY_GROUPS[group] ?? [];
}

/**
 * Reverse lookup. Returns every group this toolId belongs to (typically 0
 * or 1, but the API tolerates multi-group membership for future flexibility).
 *
 * @param {string} toolId
 * @returns {string[]}
 */
export function groupsOfTool(toolId) {
  const groups = [];
  for (const [group, members] of Object.entries(POLICY_GROUPS)) {
    if (members.includes(toolId)) groups.push(group);
  }
  return groups;
}

/**
 * Render a tool_policy object as the line list both the agentic and
 * tool_using executors put in their system prompt. Group entries come
 * first (with `any of: <members>` so the LLM knows the requirement is
 * satisfied by ANY sibling), then per-toolId entries that don't belong
 * to a group already rendered (so we never duplicate the same decision).
 *
 * Output shape: an array of plain lines. Top-level lines look like
 * `external_web_read: required (any of: ...)`, sub-lines are pre-indented
 * with two spaces (`  reason: ...`). Each caller wraps the result in
 * whatever block prefix / indentation its prompt format wants.
 *
 * Single source of truth — eliminates the previous drift where
 * agentic/prompt-builder rendered group-aware policy but tool_using/
 * agent-loop only rendered `web_search_fetch.mode`.
 *
 * @param {object|null|undefined} toolPolicy
 * @returns {string[]}
 */
export function renderToolPolicyForPrompt(toolPolicy) {
  if (!toolPolicy || typeof toolPolicy !== "object") return [];
  const lines = [];
  const renderedGroups = new Set();
  const groupEntries = toolPolicy.policy_groups;
  if (groupEntries && typeof groupEntries === "object") {
    for (const [group, decision] of Object.entries(groupEntries)) {
      if (!decision || typeof decision !== "object" || !decision.mode) continue;
      const members = toolsInGroup(group);
      const applies = members.length > 0 ? ` (any of: ${members.join(", ")})` : "";
      lines.push(`${group}: ${decision.mode}${applies}`);
      if (decision.reason) lines.push(`  reason: ${decision.reason}`);
      renderedGroups.add(group);
    }
  }
  for (const [key, decision] of Object.entries(toolPolicy)) {
    if (key === "policy_groups") continue;
    if (!decision || typeof decision !== "object" || !decision.mode) continue;
    if (decision.policy_group && renderedGroups.has(decision.policy_group)) continue;
    lines.push(`${key}: ${decision.mode}`);
    if (decision.reason) lines.push(`  reason: ${decision.reason}`);
  }
  return lines;
}
