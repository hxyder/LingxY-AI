export const DEFAULT_RESTORE_WINDOW_DAYS = 30;

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function isoFrom(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function addDaysIso(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Number(days) || 0));
  return date.toISOString();
}

export function isDeletedRecord(record = {}) {
  return typeof record?.deleted_at === "string" && record.deleted_at.length > 0;
}

export function markRecordDeleted(record = {}, {
  actor = "system",
  now = new Date().toISOString(),
  restoreWindowDays = DEFAULT_RESTORE_WINDOW_DAYS,
  reason = null
} = {}) {
  const deletedAt = isoFrom(now);
  const next = clonePlain(record);
  next.deleted_at = deletedAt;
  next.deleted_by = typeof actor === "string" && actor.trim() ? actor.trim() : "system";
  next.restore_until = addDaysIso(deletedAt, restoreWindowDays);
  if (reason) {
    next.deletion_reason = String(reason).slice(0, 200);
  } else {
    delete next.deletion_reason;
  }
  next.updated_at = deletedAt;
  delete next.restored_at;
  delete next.restored_by;
  return next;
}

export function restoreDeletedRecord(record = {}, {
  actor = "system",
  now = new Date().toISOString()
} = {}) {
  const restoredAt = isoFrom(now);
  const next = clonePlain(record);
  delete next.deleted_at;
  delete next.deleted_by;
  delete next.restore_until;
  delete next.deletion_reason;
  next.restored_at = restoredAt;
  next.restored_by = typeof actor === "string" && actor.trim() ? actor.trim() : "system";
  next.updated_at = restoredAt;
  return next;
}

export function normalizeDeletedFilter(value = false) {
  if (value === "any" || value === "all") return "any";
  if (value === "only" || value === "deleted") return "only";
  if (value === true || value === 1 || value === "1" || value === "true") return "only";
  return false;
}

export function filterDeletedRecords(records = [], { deleted = false } = {}) {
  const filter = normalizeDeletedFilter(deleted);
  const list = Array.isArray(records) ? records : [];
  if (filter === "any") return list;
  if (filter === "only") return list.filter(isDeletedRecord);
  return list.filter((record) => !isDeletedRecord(record));
}
