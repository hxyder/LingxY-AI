import { IPC_CHANNELS } from "../shared/manifest.mjs";

export function createConsoleViewModel() {
  return {
    windowId: "console",
    route: "/console",
    defaultState: "hidden",
    panes: ["task-list", "task-detail", "timeline", "artifacts", "settings", "schedules", "pending-approvals"],
    summaryCards: ["running", "queued", "today_success", "today_failed"],
    filters: ["status", "source_type", "executor", "created_at"],
    detailSections: ["summary", "timeline", "logs", "artifacts", "retries"],
    metricsEndpoint: "/metrics",
    schedulesEndpoint: "/schedules",
    approvalsEndpoint: "/approvals",
    supportsEventReplay: true,
    subscribedChannels: [
      IPC_CHANNELS.consoleOpen,
      IPC_CHANNELS.shellStatus
    ]
  };
}
