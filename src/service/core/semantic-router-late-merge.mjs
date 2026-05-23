const EXTERNAL_WEB_READ_TOOL_IDS = new Set(["web_search", "web_search_fetch", "fetch_url_content", "download_file"]);

function eventToolId(event = {}) {
  const payload = event?.payload ?? event?.data ?? {};
  return String(payload.tool_id ?? payload.tool ?? payload.name ?? "").trim();
}

function taskAlreadyUsedExternalWeb(runtime, taskId) {
  try {
    const events = runtime?.store?.getTaskEvents?.(taskId) ?? [];
    return events.some((event) =>
      ["tool_call_proposed", "tool_call_started", "tool_call_completed"].includes(event?.event_type ?? event?.event)
      && EXTERNAL_WEB_READ_TOOL_IDS.has(eventToolId(event))
    );
  } catch {
    return false;
  }
}

function cloneJson(value) {
  if (!value || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
}

function preserveExternalWebPolicy(refreshedSpec, currentSpec) {
  const currentGroup = currentSpec?.tool_policy?.policy_groups?.external_web_read
    ?? currentSpec?.tool_policy?.web_search_fetch
    ?? null;
  if (!currentGroup || currentGroup.mode === "forbidden") return refreshedSpec;
  const next = cloneJson(refreshedSpec);
  next.tool_policy = { ...(next.tool_policy ?? {}) };
  const preserved = {
    ...currentGroup,
    reason: `Preserved after external web evidence had already started; late semantic-router patch cannot revoke an in-flight evidence contract. Original reason: ${currentGroup.reason ?? "prior policy"}`
  };
  next.tool_policy.policy_groups = {
    ...(next.tool_policy.policy_groups ?? {}),
    external_web_read: preserved
  };
  for (const toolId of EXTERNAL_WEB_READ_TOOL_IDS) {
    next.tool_policy[toolId] = {
      ...(next.tool_policy[toolId] ?? {}),
      ...preserved
    };
  }
  if (currentSpec?.needs_current_web_data === true) {
    next.needs_current_web_data = true;
  }
  const currentGroups = currentSpec?.success_contract?.required_policy_groups ?? [];
  if (currentGroups.includes("external_web_read")) {
    next.success_contract = { ...(next.success_contract ?? {}) };
    next.success_contract.required_policy_groups = [
      ...new Set([
        ...(next.success_contract.required_policy_groups ?? []),
        "external_web_read"
      ])
    ];
  }
  if (currentSpec?.research_quality && !next.research_quality) {
    next.research_quality = currentSpec.research_quality;
  }
  return next;
}

export function applyLateSemanticRouterMonotonicity({ runtime, task, refreshedSpec } = {}) {
  const previousMode = task?.task_spec?.tool_policy?.web_search_fetch?.mode
    ?? task?.task_spec?.tool_policy?.policy_groups?.external_web_read?.mode
    ?? null;
  const nextMode = refreshedSpec?.tool_policy?.web_search_fetch?.mode
    ?? refreshedSpec?.tool_policy?.policy_groups?.external_web_read?.mode
    ?? null;
  if (nextMode !== "forbidden" || previousMode === "forbidden") return refreshedSpec;
  if (!taskAlreadyUsedExternalWeb(runtime, task?.task_id)) return refreshedSpec;
  return preserveExternalWebPolicy(refreshedSpec, task?.task_spec);
}
