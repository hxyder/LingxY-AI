// Codex Round 4 review: `taskConversationMap` is consulted from the echo
// continuation path with `task.task_id` directly off backend payloads, but
// bind-time the key may come from server response (string) or local cache
// (string|number) depending on path. A type mismatch lets `Map.get` miss
// silently, sending the lookup back to the less reliable conversationState
// fallback. Normalise to string at every boundary so bind/get/clear all
// agree on key shape.
function normaliseTaskKey(taskId) {
  if (taskId === null || taskId === undefined) return null;
  const key = `${taskId}`.trim();
  return key.length > 0 ? key : null;
}

export function taskOwnerConversationId(taskConversationMap, taskId) {
  const key = normaliseTaskKey(taskId);
  return key ? taskConversationMap.get(key) ?? null : null;
}

export function bindTaskToConversationId(taskConversationMap, taskId, conversationId) {
  const key = normaliseTaskKey(taskId);
  if (!key || !conversationId) return false;
  taskConversationMap.set(key, conversationId);
  return true;
}

export function clearTaskConversationBinding(taskConversationMap, taskId) {
  const key = normaliseTaskKey(taskId);
  if (!key) return false;
  return taskConversationMap.delete(key);
}
