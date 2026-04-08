import { IPC_CHANNELS } from "../shared/manifest.mjs";

export function createConsoleViewModel() {
  return {
    windowId: "console",
    route: "/console",
    defaultState: "hidden",
    panes: ["task-list", "task-detail", "artifacts", "settings"],
    subscribedChannels: [
      IPC_CHANNELS.consoleOpen,
      IPC_CHANNELS.shellStatus
    ]
  };
}
