export function looksLikeShellWindowContext(context) {
  const activeWindow = context?.activeWindow;
  const processName = `${activeWindow?.process ?? context?.processName ?? ""}`.toLowerCase();
  const title = `${activeWindow?.title ?? context?.windowTitle ?? ""}`.toLowerCase();
  return processName.includes("lingxy")
    || processName.includes("electron")
    || processName.includes("universal-context-agent")
    || processName === "uca"
    || title === "uca"
    || title === "lingxy"
    || title.includes("lingxy overlay")
    || title.includes("lingxy dock")
    || title.includes("lingxy console")
    || title.includes("lingxy preview")
    || title.includes("lingxy popup")
    || title.includes("lingxy echo bubble")
    || title.includes("uca overlay")
    || title.includes("uca dock")
    || title.includes("universal context agent")
    || (processName === "node" && (title.includes("uca") || title.includes("lingxy")));
}

export function hasReadableExternalWindowContext(context) {
  const activeWindow = context?.activeWindow;
  if (!activeWindow || activeWindow.blocked) return false;
  return Boolean(`${activeWindow.process ?? context?.processName ?? ""}`.trim()
    || `${activeWindow.title ?? context?.windowTitle ?? ""}`.trim());
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
    const shouldPrefer = looksLikeShellWindowContext(context)
      || !hasReadableExternalWindowContext(context);
    if (!shouldPrefer) return context;
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
