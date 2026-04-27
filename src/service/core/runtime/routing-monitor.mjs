/**
 * UCA-077 P4-09: routing distribution monitor.
 *
 * Pure aggregator over the existing task store + audit log. Reads
 * what's already persisted (`task.task_spec.routing_status`,
 * `routing_degraded`, `task_spec.goal`, `task_spec.executor`,
 * `task_spec.tool_policy.policy_groups.external_web_read.mode`,
 * `task.status`, plus audit entries `tool_loop.phase_gate` and
 * `tool_loop.runbook_suggested`) and computes a distribution
 * snapshot. No new persistence, no live counter — every query walks
 * the data on demand.
 *
 * Output shape is the contract: any future dashboard / weekly-report
 * surface reads from `getRoutingDistribution(runtime, options)` and
 * gets a stable shape regardless of how the underlying data evolves.
 *
 * Why on-demand vs streaming counters:
 *   - The store is small (single-machine SQLite for the desktop
 *     deployment); a full walk is sub-millisecond at any realistic
 *     scale.
 *   - On-demand keeps zero state in this module — no counter drift,
 *     no missed events on restart, no concurrent-write contention.
 *   - The producer is the audit log itself, which is already the
 *     canonical record of phase_gate / runbook decisions.
 *
 * What this DOES NOT do:
 *   - Emit events / push to dashboards. That's a Console-side concern.
 *   - Persist snapshots. The caller decides whether to log / store.
 *   - Decide thresholds for "this looks broken". That's a future
 *     alerting layer.
 *
 * @typedef {Object} RoutingDistributionWindow
 * @property {string|null} from               - ISO timestamp; null = all-time
 * @property {string|null} to                 - ISO timestamp; null = all-time
 * @property {number}      total_tasks        - tasks counted in this window
 *
 * @typedef {Object} RoutingDistributionSnapshot
 * @property {RoutingDistributionWindow}        window
 * @property {Record<string, number>}           by_executor          - count per executor id ("fast", "tool_using", "agentic", ...)
 * @property {Record<string, number>}           by_goal              - count per goal ("qa", "search_and_answer", ...)
 * @property {Record<string, number>}           by_web_policy        - count per external_web_read mode ("forbidden", "optional", "required", "absent")
 * @property {Record<string, number>}           by_routing_status    - count per routing_status ("ok", "sr_timeout", ...)
 * @property {number}                           routing_degraded_count - tasks where routing_degraded === true
 * @property {Record<string, number>}           by_task_status       - count per task.status ("success", "partial_success", "failed", "cancelled")
 * @property {Record<string, number>}           by_violation_kind    - count per phase_gate violation kind, summed across audit entries
 * @property {Record<string, number>}           by_runbook_suggested - count per runbook id suggested in audit entries
 * @property {number}                           tasks_with_research_quality - tasks where task_spec.research_quality is non-null
 * @property {Record<string, number>}           by_research_profile  - count per research_quality.profile
 */

/**
 * Compute a routing distribution snapshot.
 *
 * @param {object}              runtime
 * @param {object}              [options]
 * @param {string|null}         [options.from]    - ISO; only count tasks whose created_at is ≥ from
 * @param {string|null}         [options.to]      - ISO; only count tasks whose created_at is ≤ to
 * @returns {RoutingDistributionSnapshot}
 */
export function getRoutingDistribution(runtime, options = {}) {
  const from = typeof options.from === "string" ? options.from : null;
  const to = typeof options.to === "string" ? options.to : null;

  const allTasks = runtime?.store?.listTasks?.() ?? [];
  const tasksInWindow = allTasks.filter((t) => withinWindow(t?.created_at, from, to));
  const taskIdsInWindow = new Set(tasksInWindow.map((t) => t?.task_id).filter(Boolean));

  const byExecutor = {};
  const byGoal = {};
  const byWebPolicy = {};
  const byRoutingStatus = {};
  const byTaskStatus = {};
  const byResearchProfile = {};
  let routingDegradedCount = 0;
  let tasksWithResearchQuality = 0;

  for (const t of tasksInWindow) {
    const spec = t?.task_spec ?? null;
    bump(byExecutor, spec?.executor ?? "unknown");
    bump(byGoal, spec?.goal ?? "unknown");
    const webMode = spec?.tool_policy?.policy_groups?.external_web_read?.mode
      ?? "absent";
    bump(byWebPolicy, webMode);
    bump(byRoutingStatus, spec?.routing_status ?? "unknown");
    if (spec?.routing_degraded === true) routingDegradedCount += 1;
    bump(byTaskStatus, t?.status ?? "unknown");
    if (spec?.research_quality && typeof spec.research_quality === "object") {
      tasksWithResearchQuality += 1;
      bump(byResearchProfile, spec.research_quality.profile ?? "unknown");
    }
  }

  // Walk audit log for phase_gate + runbook entries within this window
  // (window is checked via the audit entry's task_id being in the
  // tasks-in-window set; audit entries don't carry their own
  // created_at consistently across producers, but they do carry
  // task_id, which we already filtered).
  const allAudit = runtime?.store?.listAuditLogs?.() ?? [];
  const byViolationKind = {};
  const byRunbookSuggested = {};
  for (const entry of allAudit) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.task_id && !taskIdsInWindow.has(entry.task_id)) continue;
    const subtype = entry.event_subtype;
    const payload = entry.payload ?? {};
    if (subtype === "tool_loop.phase_gate") {
      // payload.violations may be present in some emitters; otherwise
      // payload.violation_kinds (J1 onEvent shape) or violation_count
      // alone. Walk whichever shape is available.
      const kinds = Array.isArray(payload.violations)
        ? payload.violations.map((v) => v?.kind).filter(Boolean)
        : Array.isArray(payload.violation_kinds)
          ? payload.violation_kinds.filter(Boolean)
          : [];
      for (const kind of kinds) bump(byViolationKind, kind);
    } else if (subtype === "tool_loop.runbook_suggested") {
      const runbookId = payload.runbook_id;
      if (typeof runbookId === "string" && runbookId.length > 0) {
        bump(byRunbookSuggested, runbookId);
      }
    }
  }

  return {
    window: {
      from,
      to,
      total_tasks: tasksInWindow.length
    },
    by_executor: byExecutor,
    by_goal: byGoal,
    by_web_policy: byWebPolicy,
    by_routing_status: byRoutingStatus,
    routing_degraded_count: routingDegradedCount,
    by_task_status: byTaskStatus,
    by_violation_kind: byViolationKind,
    by_runbook_suggested: byRunbookSuggested,
    tasks_with_research_quality: tasksWithResearchQuality,
    by_research_profile: byResearchProfile
  };
}

/**
 * Pretty-print a snapshot as a multi-line string suitable for a
 * weekly-report email body or a console.log dump. Stable line
 * order — sections appear in the same order the typedef lists.
 *
 * @param {RoutingDistributionSnapshot} snapshot
 * @returns {string}
 */
export function formatRoutingDistribution(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "(no snapshot)";
  const lines = [];
  const w = snapshot.window;
  lines.push(`Window: ${w?.from ?? "(start)"} → ${w?.to ?? "(now)"}  total_tasks=${w?.total_tasks ?? 0}`);
  lines.push("");
  lines.push(formatSection("by_executor", snapshot.by_executor));
  lines.push(formatSection("by_goal", snapshot.by_goal));
  lines.push(formatSection("by_web_policy", snapshot.by_web_policy));
  lines.push(formatSection("by_routing_status", snapshot.by_routing_status));
  lines.push(`routing_degraded_count: ${snapshot.routing_degraded_count}`);
  lines.push(formatSection("by_task_status", snapshot.by_task_status));
  lines.push(formatSection("by_violation_kind", snapshot.by_violation_kind));
  lines.push(formatSection("by_runbook_suggested", snapshot.by_runbook_suggested));
  lines.push(`tasks_with_research_quality: ${snapshot.tasks_with_research_quality}`);
  lines.push(formatSection("by_research_profile", snapshot.by_research_profile));
  return lines.join("\n");
}

function formatSection(label, counts) {
  const entries = Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v}`);
  if (entries.length === 0) return `${label}: (none)`;
  return [`${label}:`, ...entries].join("\n");
}

function withinWindow(createdAt, from, to) {
  if (typeof createdAt !== "string") return from === null && to === null;
  if (from && createdAt < from) return false;
  if (to && createdAt > to) return false;
  return true;
}

function bump(map, key) {
  const k = typeof key === "string" && key.length > 0 ? key : "unknown";
  map[k] = (map[k] ?? 0) + 1;
}
