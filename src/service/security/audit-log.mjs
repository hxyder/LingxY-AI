import crypto from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

export function appendAuditLog(runtime, subtype, payload = {}, taskId = null) {
  return runtime.store.appendAuditLog({
    audit_id: `audit_${crypto.randomUUID()}`,
    ts: nowIso(),
    task_id: taskId,
    event_subtype: subtype,
    payload
  });
}
