import crypto from "node:crypto";

export const SUB_AGENT_RUNTIME_SCHEMA_VERSION = "1.0";

export const SUB_AGENT_DELEGATION_SOURCES = Object.freeze({
  PLANNER_SELECTED: "planner_selected"
});

export const DEFAULT_SUB_AGENT_BUDGET = Object.freeze({
  max_tool_calls: 6,
  max_prompt_tokens: 12_000,
  max_runtime_ms: 120_000,
  max_context_items: 12,
  max_context_chars: 12_000
});

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanString(value, max = 1000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function uniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.trunc(numeric);
}

function runtimeFlagEnabled(runtime = null) {
  return runtime?.featureFlags?.subAgentRuntime === true
    || runtime?.features?.subAgentRuntime === true
    || runtime?.config?.subAgentRuntime?.enabled === true
    || runtime?.subAgentRuntimeConfig?.enabled === true;
}

function explicitFlagEnabled(config = {}) {
  return config?.enabled === true
    || config?.featureFlag === true
    || config?.subAgentRuntime?.enabled === true;
}

export function isSubAgentRuntimeEnabled({ runtime = null, config = {} } = {}) {
  return runtimeFlagEnabled(runtime) || explicitFlagEnabled(config);
}

export function normalizeSubAgentBudget(budget = {}) {
  return {
    max_tool_calls: positiveInteger(budget.max_tool_calls ?? budget.maxToolCalls, DEFAULT_SUB_AGENT_BUDGET.max_tool_calls),
    max_prompt_tokens: positiveInteger(budget.max_prompt_tokens ?? budget.maxPromptTokens, DEFAULT_SUB_AGENT_BUDGET.max_prompt_tokens),
    max_runtime_ms: positiveInteger(budget.max_runtime_ms ?? budget.maxRuntimeMs, DEFAULT_SUB_AGENT_BUDGET.max_runtime_ms),
    max_context_items: positiveInteger(budget.max_context_items ?? budget.maxContextItems, DEFAULT_SUB_AGENT_BUDGET.max_context_items),
    max_context_chars: positiveInteger(budget.max_context_chars ?? budget.maxContextChars, DEFAULT_SUB_AGENT_BUDGET.max_context_chars)
  };
}

function cloneContextItemWithCharBudget(item, budget) {
  const cloned = structuredClone(item);
  if (typeof cloned.content === "string" && cloned.content.length > budget.max_context_chars) {
    cloned.content = cloned.content.slice(0, budget.max_context_chars);
    cloned.truncated = true;
  }
  if (typeof cloned.value?.text === "string" && cloned.value.text.length > budget.max_context_chars) {
    cloned.value = {
      ...cloned.value,
      text: cloned.value.text.slice(0, budget.max_context_chars),
      truncated: true
    };
  }
  return cloned;
}

export function buildIsolatedSubAgentContext({
  parentCompiledContext = null,
  assignedScope = {},
  budget = {}
} = {}) {
  const limits = normalizeSubAgentBudget(budget);
  const selected = Array.isArray(parentCompiledContext?.selected)
    ? parentCompiledContext.selected
    : [];
  const allowedIds = new Set(uniqueStrings(
    assignedScope.context_item_ids ?? assignedScope.contextItemIds ?? []
  ));
  const scopedSelected = selected
    .filter((item) => allowedIds.has(item?.id))
    .slice(0, limits.max_context_items)
    .map((item) => cloneContextItemWithCharBudget(item, limits));

  return {
    schema_version: parentCompiledContext?.schema_version ?? "1.0",
    owner: "service/sub-agent-runtime",
    isolation: {
      schema_version: SUB_AGENT_RUNTIME_SCHEMA_VERSION,
      scope_id: assignedScope.scope_id ?? assignedScope.scopeId ?? null,
      parent_context_item_count: selected.length,
      included_context_item_ids: scopedSelected.map((item) => item.id),
      omitted_context_item_count: Math.max(0, selected.length - scopedSelected.length)
    },
    selected: scopedSelected,
    omitted: [],
    metrics: {
      ...(parentCompiledContext?.metrics ?? {}),
      sub_agent_context_items: scopedSelected.length
    }
  };
}

function normalizeToolSurface({ parentAllowedToolIds = [], assignedScope = {} } = {}) {
  const parentAllowed = new Set(uniqueStrings(parentAllowedToolIds));
  const requested = uniqueStrings(assignedScope.allowed_tool_ids ?? assignedScope.allowedToolIds ?? []);
  if (requested.length === 0) {
    throw new Error("sub-agent assigned scope must name allowed_tool_ids");
  }
  const disallowed = requested.filter((toolId) => !parentAllowed.has(toolId));
  if (disallowed.length > 0) {
    throw new Error(`sub-agent allowed tool escape: ${disallowed.join(", ")}`);
  }
  return requested;
}

function normalizeDelegation(delegation = {}) {
  const source = delegation.source ?? delegation.delegation_source ?? null;
  if (source !== SUB_AGENT_DELEGATION_SOURCES.PLANNER_SELECTED) {
    throw new Error("sub-agent delegation must be planner_selected");
  }
  return {
    source,
    planner_step_id: delegation.planner_step_id ?? delegation.plannerStepId ?? null,
    reason: cleanString(delegation.reason ?? "planner selected bounded child run", 500)
  };
}

export function createLinkedSubAgentCancellation({
  parentTaskId,
  childTaskId,
  parentSignal = null
} = {}) {
  const controller = new AbortController();
  const token = {
    token_id: newId("sact"),
    parent_task_id: parentTaskId ?? null,
    child_task_id: childTaskId ?? null,
    propagation: "parent_to_child",
    status: controller.signal.aborted ? "aborted" : "active"
  };
  const abort = (reason) => {
    if (!controller.signal.aborted) {
      token.status = "aborted";
      controller.abort(reason ?? new Error("parent task cancelled"));
    }
  };
  if (parentSignal?.aborted) {
    abort(parentSignal.reason ?? new Error("parent task cancelled"));
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", () => {
      abort(parentSignal.reason ?? new Error("parent task cancelled"));
    }, { once: true });
  }
  return {
    token,
    signal: controller.signal,
    cancel: abort
  };
}

export function createSubAgentRunContract({
  runtime = null,
  config = {},
  parentTask,
  childTask,
  assignedScope = {},
  parentCompiledContext = null,
  parentAllowedToolIds = [],
  delegation = {},
  now = nowIso()
} = {}) {
  if (!isSubAgentRuntimeEnabled({ runtime, config })) {
    return {
      enabled: false,
      reason: "feature_flag_disabled"
    };
  }
  if (!parentTask?.task_id) throw new Error("sub-agent parent task required");
  if (!childTask?.task_id) throw new Error("sub-agent child task required");
  if (parentTask.task_id === childTask.task_id) {
    throw new Error("sub-agent child task must differ from parent task");
  }

  const budget = normalizeSubAgentBudget({
    ...(config?.budget ?? {}),
    ...(assignedScope?.budget ?? {})
  });
  const allowedToolIds = normalizeToolSurface({ parentAllowedToolIds, assignedScope });
  const normalizedDelegation = normalizeDelegation(delegation);
  const isolatedContext = buildIsolatedSubAgentContext({
    parentCompiledContext,
    assignedScope,
    budget
  });
  const cancellation = createLinkedSubAgentCancellation({
    parentTaskId: parentTask.task_id,
    childTaskId: childTask.task_id,
    parentSignal: config?.parentSignal ?? null
  });

  return {
    schema_version: SUB_AGENT_RUNTIME_SCHEMA_VERSION,
    contract_id: newId("sacontract"),
    enabled: true,
    status: "planned",
    parent_task_id: parentTask.task_id,
    child_task_id: childTask.task_id,
    conversation_id: childTask.conversation_id ?? parentTask.conversation_id ?? null,
    assigned_scope: {
      scope_id: assignedScope.scope_id ?? assignedScope.scopeId ?? newId("sascope"),
      objective: cleanString(assignedScope.objective ?? childTask.user_command ?? childTask.intent ?? "", 800),
      context_item_ids: isolatedContext.isolation.included_context_item_ids,
      allowed_tool_ids: allowedToolIds
    },
    isolated_compiled_context: isolatedContext,
    allowed_tool_ids: allowedToolIds,
    budget,
    cancellation_token: cancellation.token,
    delegation: normalizedDelegation,
    created_at: now
  };
}

export function validateSubAgentBudgetUsage(contract, usage = {}) {
  const budget = normalizeSubAgentBudget(contract?.budget ?? {});
  const observed = {
    tool_calls: positiveInteger(usage.tool_calls ?? usage.toolCalls, 0),
    prompt_tokens: positiveInteger(usage.prompt_tokens ?? usage.promptTokens, 0),
    runtime_ms: positiveInteger(usage.runtime_ms ?? usage.runtimeMs, 0),
    context_items: positiveInteger(usage.context_items ?? usage.contextItems, 0)
  };
  const violations = [];
  if (observed.tool_calls > budget.max_tool_calls) violations.push("tool_call_budget_exhausted");
  if (observed.prompt_tokens > budget.max_prompt_tokens) violations.push("prompt_token_budget_exhausted");
  if (observed.runtime_ms > budget.max_runtime_ms) violations.push("runtime_budget_exhausted");
  if (observed.context_items > budget.max_context_items) violations.push("context_item_budget_exhausted");
  return {
    ok: violations.length === 0,
    exhausted: violations.length > 0,
    observed,
    budget,
    violations
  };
}

function toolCallsFromEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.event_type === "tool_call_started" || event?.event_type === "tool_call_completed")
    .map((event) => ({
      tool_id: event.payload?.tool_id ?? event.payload?.tool ?? null,
      success: event.payload?.success ?? null,
      event_type: event.event_type
    }))
    .filter((call) => call.tool_id);
}

export function buildSubAgentResultReport({
  contract,
  childTask = {},
  events = [],
  usage = {},
  summary = null,
  now = nowIso()
} = {}) {
  if (!contract?.enabled) throw new Error("sub-agent contract required");
  const allowed = new Set(contract.allowed_tool_ids ?? []);
  const toolCalls = toolCallsFromEvents(events);
  const toolEscapes = toolCalls
    .map((call) => call.tool_id)
    .filter((toolId) => !allowed.has(toolId));
  const budgetResult = validateSubAgentBudgetUsage(contract, {
    ...usage,
    tool_calls: usage.tool_calls ?? usage.toolCalls ?? toolCalls.length,
    context_items: usage.context_items
      ?? usage.contextItems
      ?? contract.isolated_compiled_context?.selected?.length
      ?? 0
  });
  const violations = [
    ...budgetResult.violations,
    ...toolEscapes.map((toolId) => `tool_surface_escape:${toolId}`)
  ];

  return {
    schema_version: SUB_AGENT_RUNTIME_SCHEMA_VERSION,
    report_id: newId("sareport"),
    contract_id: contract.contract_id,
    parent_task_id: contract.parent_task_id,
    child_task_id: contract.child_task_id,
    assigned_scope_id: contract.assigned_scope?.scope_id ?? null,
    status: childTask.status ?? "unknown",
    summary: cleanString(summary ?? childTask.result_summary ?? childTask.failure_user_message ?? "", 1200),
    tool_calls: toolCalls,
    budget: budgetResult,
    violations,
    ok: violations.length === 0 && ["success", "partial_success"].includes(childTask.status),
    created_at: now
  };
}

export function createSubAgentRuntimeService({ runtime = null } = {}) {
  return {
    createRunContract(params = {}) {
      return createSubAgentRunContract({ runtime, ...params });
    },
    buildResultReport(params = {}) {
      return buildSubAgentResultReport(params);
    },
    createCancellationBoundary(params = {}) {
      return createLinkedSubAgentCancellation(params);
    },
    validateBudgetUsage(contract, usage = {}) {
      return validateSubAgentBudgetUsage(contract, usage);
    }
  };
}
