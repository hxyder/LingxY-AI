import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

export const JSONL_SKIP_EVENT_TYPES = new Set([
  "text_delta",
  "tool_input_delta",
  "reasoning_delta",
  "conversation_step",
  "heartbeat"
]);

export const TASK_LOG_MAX_FILES = 500;
export const TASK_LOG_ROTATE_EVERY = 128;

let taskLogWriteCounter = 0;
const taskLogTails = new Map();

export function enqueueTaskLogWrite(taskId, work) {
  const prev = taskLogTails.get(taskId) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => { /* swallow; log is best-effort */ });
  taskLogTails.set(taskId, next);
  // Keep the map from growing unbounded: once the tail settles, drop it
  // unless a newer write has replaced it.
  next.finally(() => {
    if (taskLogTails.get(taskId) === next) taskLogTails.delete(taskId);
  });
  return next;
}

export function persistTaskEvent(runtime, record) {
  if (JSONL_SKIP_EVENT_TYPES.has(record.event_type)) return Promise.resolve();
  const logsDir = runtime.paths?.logsDir;
  if (!logsDir || !record.task_id) return Promise.resolve();
  return enqueueTaskLogWrite(record.task_id, async () => {
    const dir = path.join(logsDir, "tasks");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${record.task_id}.jsonl`);
    await appendFile(file, JSON.stringify(record) + "\n", "utf8");

    taskLogWriteCounter += 1;
    if (taskLogWriteCounter % TASK_LOG_ROTATE_EVERY === 0) {
      void rotateTaskLogs(dir).catch(() => { /* best-effort */ });
    }
  });
}

export async function rotateTaskLogs(dir, { maxFiles = TASK_LOG_MAX_FILES } = {}) {
  const entries = await readdir(dir).catch(() => []);
  if (entries.length <= maxFiles) return;
  const stats = await Promise.all(entries.map(async (name) => {
    try {
      const info = await stat(path.join(dir, name));
      return { name, mtime: info.mtimeMs };
    } catch { return null; }
  }));
  const sorted = stats.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
  const toDelete = sorted.slice(0, sorted.length - maxFiles);
  for (const entry of toDelete) {
    try { await unlink(path.join(dir, entry.name)); } catch { /* ignore */ }
  }
}

export async function flushTaskLogs() {
  const pending = [...taskLogTails.values()];
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}

export async function readTaskEventLog(runtime, taskId) {
  if (!runtime?.paths?.logsDir || !taskId) return [];
  const file = path.join(runtime.paths.logsDir, "tasks", `${taskId}.jsonl`);
  try {
    const text = await readFile(file, "utf8");
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function resetTaskLogStateForTests() {
  taskLogWriteCounter = 0;
  taskLogTails.clear();
}
