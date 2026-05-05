export const DESKTOP_CONSOLE_ACTOR = "desktop_console";
export const DESKTOP_OVERLAY_ACTOR = "desktop_overlay";
export const DESKTOP_SHELL_ACTOR = "desktop_shell";
export const DESKTOP_POPUP_CARD_ACTOR = "popup_card";
export const DESKTOP_UNKNOWN_ACTOR = "desktop_unknown";

export function desktopActorForWindowId(windowId) {
  switch (`${windowId ?? ""}`.trim()) {
    case "console":
      return DESKTOP_CONSOLE_ACTOR;
    case "overlay":
      return DESKTOP_OVERLAY_ACTOR;
    case "popup-card":
      return DESKTOP_POPUP_CARD_ACTOR;
    case "dock":
    case "echo-bubble":
      return DESKTOP_SHELL_ACTOR;
    default:
      return DESKTOP_UNKNOWN_ACTOR;
  }
}

export function desktopActorForSender(sender, windows = new Map()) {
  if (!sender || !windows || typeof windows[Symbol.iterator] !== "function") {
    return DESKTOP_UNKNOWN_ACTOR;
  }
  for (const [windowId, windowRef] of windows) {
    if (windowRef?.webContents === sender) {
      return desktopActorForWindowId(windowId);
    }
  }
  return DESKTOP_UNKNOWN_ACTOR;
}
