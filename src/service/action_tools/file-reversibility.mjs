import crypto from "node:crypto";
import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

function safeName(value = "taskless") {
  return String(value || "taskless").replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 80) || "taskless";
}

function taskIdFromContext(ctx = {}) {
  return ctx.task?.task_id ?? ctx.taskId ?? ctx.task_id ?? "taskless";
}

function checkpointRoot(ctx = {}, targetPath = "") {
  if (ctx.reversibility?.checkpointDir) return path.resolve(ctx.reversibility.checkpointDir);
  const base = ctx.outputDir ? path.resolve(ctx.outputDir) : path.dirname(path.resolve(targetPath));
  return path.join(base, ".lingxy-checkpoints", safeName(taskIdFromContext(ctx)));
}

function checkpointId(toolId, targetPath) {
  const hash = crypto.createHash("sha256")
    .update(`${toolId}:${path.resolve(targetPath)}:${Date.now()}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 16);
  return `fw018_${hash}`;
}

export async function prepareFileReversibilityCheckpoint(ctx = {}, {
  toolId,
  targetPath,
  operation
} = {}) {
  const absTarget = path.resolve(String(targetPath ?? ""));
  if (!absTarget) throw new Error("checkpoint target path is required");
  const id = checkpointId(toolId ?? "file_tool", absTarget);
  const root = checkpointRoot(ctx, absTarget);
  await mkdir(root, { recursive: true });

  let existing = null;
  try {
    existing = await lstat(absTarget);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const base = {
    checkpoint_id: id,
    reversible: true,
    tool_id: toolId ?? null,
    operation: operation ?? "file_mutation",
    target_path: absTarget,
    created_at: new Date().toISOString()
  };

  if (!existing) {
    return {
      ...base,
      existed_before: false,
      backup_path: null,
      reverse_operation: "delete_created_file"
    };
  }

  if (!existing.isFile()) {
    throw new Error(`checkpoint target is not a regular file: ${absTarget}`);
  }

  const ext = path.extname(absTarget);
  const backupPath = path.join(root, `${id}${ext || ".bak"}`);
  await copyFile(absTarget, backupPath);
  return {
    ...base,
    existed_before: true,
    backup_path: backupPath,
    reverse_operation: "restore_file"
  };
}

function eventPayload(event = {}) {
  return event.payload ?? event.data ?? {};
}

function reversibilityFromEvent(event = {}) {
  const payload = eventPayload(event);
  return payload.metadata?.reversibility
    ?? payload.result?.metadata?.reversibility
    ?? payload.reversibility
    ?? null;
}

function reversibilitySidecarsFromEvent(event = {}) {
  const payload = eventPayload(event);
  return payload.metadata?.reversibility_sidecars
    ?? payload.result?.metadata?.reversibility_sidecars
    ?? payload.reversibility_sidecars
    ?? [];
}

function normalizeCheckpoint(checkpoint = {}, payload = {}, event = {}) {
  if (!checkpoint?.reversible || !checkpoint.checkpoint_id || !checkpoint.target_path) {
    return null;
  }
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    reversible: true,
    tool_id: checkpoint.tool_id ?? payload.tool_id ?? payload.tool ?? null,
    operation: checkpoint.operation ?? "file_mutation",
    reverse_operation: checkpoint.reverse_operation ?? null,
    target_path: checkpoint.target_path,
    backup_path: checkpoint.backup_path ?? null,
    existed_before: checkpoint.existed_before === true,
    created_at: checkpoint.created_at ?? event.ts ?? event.created_at ?? null
  };
}

export function collectFileReversibilityCheckpoints(events = []) {
  return (Array.isArray(events) ? events : [])
    .flatMap((event) => {
      const payload = eventPayload(event);
      return [
        reversibilityFromEvent(event),
        ...(
          Array.isArray(reversibilitySidecarsFromEvent(event))
            ? reversibilitySidecarsFromEvent(event)
            : []
        )
      ].map((checkpoint) => normalizeCheckpoint(checkpoint, payload, event));
    })
    .filter(Boolean);
}

export async function applyFileReversibilityCheckpoint(checkpoint = {}, {
  actor = "system",
  now = new Date().toISOString()
} = {}) {
  if (!checkpoint?.checkpoint_id) {
    throw new Error("checkpoint_id is required");
  }
  const targetPath = path.resolve(String(checkpoint.target_path ?? ""));
  if (!targetPath) {
    throw new Error("checkpoint target path is required");
  }

  if (checkpoint.reverse_operation === "restore_file") {
    const backupPath = path.resolve(String(checkpoint.backup_path ?? ""));
    if (!backupPath || backupPath === targetPath) {
      throw new Error("restore checkpoint requires a distinct backup file");
    }
    const backup = await lstat(backupPath);
    if (!backup.isFile()) {
      throw new Error(`checkpoint backup is not a regular file: ${backupPath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(backupPath, targetPath);
    return {
      ok: true,
      checkpoint_id: checkpoint.checkpoint_id,
      reverse_operation: "restore_file",
      target_path: targetPath,
      backup_path: backupPath,
      restored_at: now,
      restored_by: actor
    };
  }

  if (checkpoint.reverse_operation === "delete_created_file") {
    if (checkpoint.existed_before === true) {
      throw new Error("delete_created_file checkpoint cannot delete a file that existed before the mutation");
    }
    await rm(targetPath, { force: true });
    return {
      ok: true,
      checkpoint_id: checkpoint.checkpoint_id,
      reverse_operation: "delete_created_file",
      target_path: targetPath,
      restored_at: now,
      restored_by: actor
    };
  }

  throw new Error(`unsupported reverse operation: ${checkpoint.reverse_operation ?? "unknown"}`);
}
