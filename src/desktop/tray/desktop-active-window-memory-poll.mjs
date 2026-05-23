export function createActiveWindowMemoryPoll({
  captureActiveWindowContext,
  intervalMs = 3000
} = {}) {
  if (typeof captureActiveWindowContext !== "function") {
    throw new TypeError("createActiveWindowMemoryPoll requires captureActiveWindowContext.");
  }

  let activeWindowMemoryPollInFlight = false;

  function startActiveWindowMemoryPoll() {
    setInterval(() => {
      if (activeWindowMemoryPollInFlight) return;
      activeWindowMemoryPollInFlight = true;
      captureActiveWindowContext({ includeSelection: false })
        .catch(() => {})
        .finally(() => { activeWindowMemoryPollInFlight = false; });
    }, intervalMs);
  }

  return {
    startActiveWindowMemoryPoll
  };
}
