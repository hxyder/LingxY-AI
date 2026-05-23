import { IPC_CHANNELS } from "../shared/manifest.mjs";

export function createOverlayViewModel() {
  return {
    windowId: "overlay",
    route: "/overlay",
    defaultState: "hidden",
    acceptsFocus: true,
    supportsContextPreview: true,
    commands: [
      "read_clipboard",
      "summarize",
      "translate",
      "rewrite",
      "open_console"
    ],
    subscribedChannels: [
      IPC_CHANNELS.overlayToggle,
      IPC_CHANNELS.shellStatus,
      IPC_CHANNELS.contextPreviewRequested
    ]
  };
}
