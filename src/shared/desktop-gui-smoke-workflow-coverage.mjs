export const DESKTOP_GUI_DAILY_WORKFLOW_COVERAGE_SCHEMA_VERSION = 1;

export const DESKTOP_GUI_DAILY_WORKFLOW_GROUPS = Object.freeze([
  Object.freeze({
    workflow: "conversation_continuity",
    requiredChecks: Object.freeze([
      "console_conversation_isolation",
      "console_chat_branch_fork",
      "console_chat_branch_rewind",
      "console_chat_branch_edit"
    ])
  }),
  Object.freeze({
    workflow: "task_operations",
    requiredChecks: Object.freeze([
      "task_cancel_ipc_bridge",
      "overlay_stop_button_cancel",
      "console_stop_button_cancel",
      "console_task_detail_cancel",
      "overlay_inline_error_retry",
      "console_inline_error_retry"
    ])
  }),
  Object.freeze({
    workflow: "artifact_workflow",
    requiredChecks: Object.freeze([
      "preview_generate_document_initial_draft",
      "preview_generate_document_draft_family_matrix",
      "preview_generate_document_screenshot_diff",
      "preview_task_binding_isolation"
    ])
  })
]);

function checkNameSet(resultOrNames = []) {
  if (Array.isArray(resultOrNames)) {
    return new Set(resultOrNames.map((entry) => typeof entry === "string" ? entry : entry?.name).filter(Boolean));
  }
  if (Array.isArray(resultOrNames.checks)) {
    return new Set(resultOrNames.checks.map((entry) => entry?.name).filter(Boolean));
  }
  return new Set();
}

export function summarizeDesktopGuiDailyWorkflowCoverage(resultOrNames = []) {
  const names = checkNameSet(resultOrNames);
  return DESKTOP_GUI_DAILY_WORKFLOW_GROUPS.map((group) => {
    const missing = group.requiredChecks.filter((name) => !names.has(name));
    return {
      workflow: group.workflow,
      ok: missing.length === 0,
      requiredChecks: [...group.requiredChecks],
      missing
    };
  });
}

export function validateDesktopGuiDailyWorkflowCoverage(resultOrNames = []) {
  const workflows = summarizeDesktopGuiDailyWorkflowCoverage(resultOrNames);
  const missing = workflows.flatMap((workflow) =>
    workflow.missing.map((check) => `${workflow.workflow}.${check}`)
  );
  return {
    ok: missing.length === 0,
    missing,
    workflows
  };
}
