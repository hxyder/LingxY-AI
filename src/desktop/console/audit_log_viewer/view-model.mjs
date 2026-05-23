export function buildAuditLogViewerModel(entries) {
  return {
    total: entries.length,
    entries: entries.map((entry) => ({
      id: entry.audit_id,
      ts: entry.ts,
      subtype: entry.event_subtype,
      taskId: entry.task_id ?? null
    }))
  };
}
