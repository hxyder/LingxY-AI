export function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizeApprovalDecisionPayload(payload = {}) {
  return {
    approvalId: `${payload.approvalId ?? payload.approval_id ?? payload.id ?? ""}`.trim(),
    overrides: normalizePlainObject(payload.overrides),
    reason: `${payload.reason ?? ""}`.trim()
  };
}

export function buildApprovalDecisionBody(payload, actor, action) {
  const body = { actor };
  if (action === "approve" && payload.overrides) {
    body.overrides = payload.overrides;
  }
  if (action === "reject" && payload.reason) {
    body.reason = payload.reason;
  }
  return body;
}
