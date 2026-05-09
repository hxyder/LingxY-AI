const RESUME_VERSION = 1;

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function resumeToken(approvalId) {
  const id = cleanString(approvalId) ?? "unknown";
  return `approval:${id}`;
}

export function createApprovalResumeState({
  approvalId,
  taskId,
  toolId = null,
  createdAt = null
} = {}) {
  const sourceTaskId = cleanString(taskId);
  if (!sourceTaskId) return null;
  return {
    version: RESUME_VERSION,
    kind: "hitl_approval",
    state: "interrupted",
    resume_token: resumeToken(approvalId),
    approval_id: cleanString(approvalId),
    task_id: sourceTaskId,
    tool_id: cleanString(toolId),
    created_at: createdAt ?? new Date().toISOString(),
    decided_at: null,
    decided_by: null,
    decision: null,
    resulting_task_id: null
  };
}

export function attachApprovalResumeMetadata(metadata = {}, {
  approvalId,
  createdAt = null
} = {}) {
  const existing = metadata?.approval_resume;
  if (existing?.resume_token && existing?.task_id) return metadata;
  const state = createApprovalResumeState({
    approvalId,
    taskId: metadata?.task_id,
    toolId: metadata?.tool_id,
    createdAt
  });
  if (!state) return metadata;
  return {
    ...metadata,
    approval_resume: state
  };
}

export function resolveApprovalResumeMetadata(metadata = {}, {
  decision,
  decidedAt = null,
  actor = null,
  resultingTaskId = null
} = {}) {
  const existing = metadata?.approval_resume;
  if (!existing?.resume_token || !existing?.task_id) return metadata;
  const normalizedDecision = decision === "reject" || decision === "rejected" ? "rejected" : "approved";
  return {
    ...metadata,
    approval_resume: {
      ...existing,
      state: normalizedDecision === "approved" ? "resumed" : "rejected",
      decision: normalizedDecision,
      decided_at: decidedAt ?? new Date().toISOString(),
      decided_by: cleanString(actor),
      resulting_task_id: cleanString(resultingTaskId)
    }
  };
}
