export function looksLikeShellWindowContext(context) {
  const activeWindow = context?.activeWindow;
  const processName = `${activeWindow?.process ?? context?.processName ?? ""}`.toLowerCase();
  const title = `${activeWindow?.title ?? context?.windowTitle ?? ""}`.toLowerCase();
  return processName.includes("electron")
    || processName.includes("universal-context-agent")
    || processName === "uca"
    || title === "uca"
    || title.includes("uca overlay")
    || title.includes("uca dock")
    || title.includes("universal context agent")
    || (processName === "node" && title.includes("uca"));
}

export function createExternalWindowContextMemory() {
  let lastExternalWindowContext = null;

  function rememberExternalWindowContext(context) {
    if (!context?.activeWindow || context.activeWindow.blocked) return;
    if (looksLikeShellWindowContext(context)) return;
    lastExternalWindowContext = {
      context,
      updatedAt: Date.now()
    };
  }

  function preferLastExternalWindowContext(context, options = {}) {
    if (!options?.preferLastExternal) return context;
    if (!looksLikeShellWindowContext(context)) return context;
    const maxAgeMs = Number(options.maxExternalAgeMs ?? 10 * 60_000);
    if (!lastExternalWindowContext?.context) return context;
    if (Date.now() - lastExternalWindowContext.updatedAt > maxAgeMs) return context;
    return lastExternalWindowContext.context;
  }

  return {
    rememberExternalWindowContext,
    preferLastExternalWindowContext
  };
}
