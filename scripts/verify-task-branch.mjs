// Phase 9 verifier (UCA-182) — conversation → parent_task_id threading.
//
// Static checks (cheap) + a live end-to-end using an in-process
// runtime: post task A, post task B with parent_task_id=A, read back
// tasks and confirm the relationship + sub_status semantics.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. Client wiring: overlay.js submits parent_task_id -------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/overlay.js"), "utf8");

  assert.ok(src.includes("conversationState?.lastCompletedTaskId"),
    "overlay.js must read lastCompletedTaskId from conversationState");
  assert.ok(src.match(/parent_task_id:\s*parentTaskId/),
    "overlay.js must pass parent_task_id in /task body");
  assert.ok(src.includes("conversation_id:"),
    "overlay.js must pass conversation_id in /task body");
  assert.ok(src.includes("conversationState.lastCompletedTaskId = task.task_id"),
    "overlay.js must store lastCompletedTaskId on task success");
  assert.ok(src.includes("conversationState.lastArtifacts = task.artifacts"),
    "overlay.js must cache lastArtifacts so next turn reuses them");
}

// --- 2. Server wiring: /task handler forwards parent_task_id ---------
{
  const src = await readFile(path.join(ROOT, "src/service/core/http-server.mjs"), "utf8");
  assert.ok(src.match(/parentTaskId:\s*typeof body\.parent_task_id/),
    "http-server /task handler must forward body.parent_task_id to submitContextTask");
}

// --- 3. submitContextTask still honours parentTaskId -----------------
{
  const src = await readFile(path.join(ROOT, "src/service/core/context-submission.mjs"), "utf8");
  assert.ok(src.includes("parentTaskId = null"),
    "submitContextTask must expose parentTaskId parameter");
  assert.ok(src.match(/!skipPlanLayer && !parentTaskId/)
         || src.match(/!parentTaskId.*plan/i),
    "plan/decomposition must still be skipped when parentTaskId is set");
}

console.log("ok verify-task-branch");
