export function createWindowMessageQueue({
  getWindow,
  isWindowReady
} = {}) {
  if (typeof getWindow !== "function") throw new TypeError("createWindowMessageQueue requires getWindow.");
  if (typeof isWindowReady !== "function") throw new TypeError("createWindowMessageQueue requires isWindowReady.");

  const pendingWindowMessages = new Map();

  function enqueueWindowMessage(windowId, channel, payload) {
    const target = getWindow(windowId);
    if (target && isWindowReady(windowId)) {
      target.webContents.send(channel, payload);
      return;
    }

    const queued = pendingWindowMessages.get(windowId) ?? [];
    queued.push({ channel, payload });
    pendingWindowMessages.set(windowId, queued);
  }

  function flushWindowMessages(windowId) {
    const target = getWindow(windowId);
    const queued = pendingWindowMessages.get(windowId) ?? [];
    if (!target || queued.length === 0) {
      return;
    }
    for (const message of queued) {
      target.webContents.send(message.channel, message.payload);
    }
    pendingWindowMessages.delete(windowId);
  }

  function clearWindowMessages(windowId) {
    pendingWindowMessages.delete(windowId);
  }

  return {
    clearWindowMessages,
    enqueueWindowMessage,
    flushWindowMessages
  };
}
