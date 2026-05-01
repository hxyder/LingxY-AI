export function taskOwnerConversationId(taskConversationMap, taskId) {
  return taskId ? taskConversationMap.get(taskId) ?? null : null;
}

export function bindTaskToConversationId(taskConversationMap, taskId, conversationId) {
  if (!taskId || !conversationId) return false;
  taskConversationMap.set(taskId, conversationId);
  return true;
}

export function clearTaskConversationBinding(taskConversationMap, taskId) {
  if (!taskId) return false;
  return taskConversationMap.delete(taskId);
}
