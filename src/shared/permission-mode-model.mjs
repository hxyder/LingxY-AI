import { buildPrivacySandboxSummary } from "./privacy-sandbox-policy.mjs";

const MODE_DEFINITIONS = Object.freeze({
  interactive: {
    id: "interactive",
    label: "Interactive",
    summary: "User-present task; confirmation-required tools pause for approval.",
    user_present: true,
    approval_prompt_available: true,
    unattended_safe: false,
    approval_threshold: "confirmation_required_tools",
    approval_behavior: "prompt_for_confirmation_required",
    blocks_high_risk_tools: false
  },
  approval_required: {
    id: "approval_required",
    label: "Approval required",
    summary: "Task is expected to pause before side effects that require approval.",
    user_present: true,
    approval_prompt_available: true,
    unattended_safe: false,
    approval_threshold: "confirmation_required_tools",
    approval_behavior: "prompt_for_confirmation_required",
    blocks_high_risk_tools: false
  },
  unattended_safe: {
    id: "unattended_safe",
    label: "Unattended safe",
    summary: "Background-safe task; no interactive approval prompt is shown and high-risk tools are blocked.",
    user_present: false,
    approval_prompt_available: false,
    unattended_safe: true,
    approval_threshold: "high_risk_tools_blocked",
    approval_behavior: "do_not_prompt",
    blocks_high_risk_tools: true
  },
  background: {
    id: "background",
    label: "Background",
    summary: "Async desktop task; confirmation-required tools still pause for approval.",
    user_present: true,
    approval_prompt_available: true,
    unattended_safe: false,
    approval_threshold: "confirmation_required_tools",
    approval_behavior: "prompt_for_confirmation_required",
    blocks_high_risk_tools: false
  },
  auto: {
    id: "auto",
    label: "Auto",
    summary: "Runtime-selected task path; confirmation-required tools still pause for approval.",
    user_present: true,
    approval_prompt_available: true,
    unattended_safe: false,
    approval_threshold: "confirmation_required_tools",
    approval_behavior: "prompt_for_confirmation_required",
    blocks_high_risk_tools: false
  },
  single: {
    id: "single",
    label: "Single step",
    summary: "Legacy single-step task path; confirmation-required tools still pause for approval.",
    user_present: true,
    approval_prompt_available: true,
    unattended_safe: false,
    approval_threshold: "confirmation_required_tools",
    approval_behavior: "prompt_for_confirmation_required",
    blocks_high_risk_tools: false
  }
});

const DEFAULT_MODE_ID = "interactive";

export function normalizeExecutionMode(value) {
  const id = String(value ?? "").trim().toLowerCase();
  return MODE_DEFINITIONS[id] ? id : DEFAULT_MODE_ID;
}

export function getExecutionModeDefinition(value) {
  return MODE_DEFINITIONS[normalizeExecutionMode(value)];
}

export function buildPermissionModeContract({
  executionMode = DEFAULT_MODE_ID,
  privacyConfig = {},
  task = null
} = {}) {
  const rawMode = String(executionMode ?? "").trim() || DEFAULT_MODE_ID;
  const mode = getExecutionModeDefinition(rawMode);
  const privacy = buildPrivacySandboxSummary(privacyConfig);
  const localOnly = privacy.mode === "local_only" || privacy.network === "block";
  return {
    schema_version: "1.0",
    owner: "shared.permission_mode_model",
    mode_id: mode.id,
    raw_execution_mode: rawMode,
    label: mode.label,
    summary: mode.summary,
    user_visible: {
      interactive: mode.user_present,
      approval_required: mode.approval_prompt_available,
      unattended_safe: mode.unattended_safe,
      local_only: localOnly,
      dry_run_like: false
    },
    approval: {
      threshold: mode.approval_threshold,
      behavior: mode.approval_behavior,
      blocks_high_risk_tools: mode.blocks_high_risk_tools,
      prompt_available: mode.approval_prompt_available
    },
    privacy: {
      mode: privacy.mode,
      active: privacy.active,
      blocked_capabilities: privacy.blockedCapabilities
    },
    tool_surface: {
      network_allowed: privacy.network !== "block",
      file_read_allowed: privacy.file_read !== "block",
      file_write_allowed: privacy.file_write !== "block",
      secrets_allowed: privacy.secrets !== "block"
    },
    trace: {
      task_id: task?.task_id ?? null,
      persisted_on_task: true,
      audited_by_task_created_event: true
    }
  };
}

export function shouldPromptForToolApproval({ executionMode, risk } = {}) {
  return Boolean(risk?.requires_confirmation) && normalizeExecutionMode(executionMode) !== "unattended_safe";
}

export function shouldBlockToolForExecutionMode({ executionMode, risk } = {}) {
  return normalizeExecutionMode(executionMode) === "unattended_safe" && risk?.risk_level === "high";
}

export function describePermissionModeContract(contractOrTask = {}) {
  const contract = contractOrTask?.mode_id
    ? contractOrTask
    : (contractOrTask?.context_packet?.selection_metadata?.permission_mode_contract
      ?? contractOrTask?.selection_metadata?.permission_mode_contract
      ?? buildPermissionModeContract({
        executionMode: contractOrTask?.execution_mode ?? contractOrTask?.executionMode
      }));
  const bits = [contract.label ?? getExecutionModeDefinition(contract.mode_id).label];
  if (contract.user_visible?.local_only) bits.push("Local only");
  if (contract.user_visible?.unattended_safe) bits.push("No prompt");
  if (contract.user_visible?.dry_run_like) bits.push("Dry run");
  return bits.join(" · ");
}

export { MODE_DEFINITIONS as PERMISSION_MODE_DEFINITIONS };
