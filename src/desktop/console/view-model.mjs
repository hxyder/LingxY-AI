import { IPC_CHANNELS } from "../shared/manifest.mjs";

export function createConsoleViewModel() {
  return {
    windowId: "console",
    route: "/console",
    defaultState: "hidden",
    panes: ["task-list", "task-detail", "timeline", "artifacts", "settings", "schedules", "pending-approvals", "template-editor", "dag-view", "budget-dashboard", "history-search"],
    summaryCards: ["running", "queued", "today_success", "today_failed", "monthly_budget_usage"],
    filters: ["status", "source_type", "executor", "template_id", "created_at"],
    detailSections: ["summary", "timeline", "logs", "artifacts", "retries", "cost", "children"],
    metricsEndpoint: "/metrics",
    schedulesEndpoint: "/schedules",
    approvalsEndpoint: "/approvals",
    templatesEndpoint: "/templates",
    budgetEndpoint: "/budget",
    historySearchEndpoint: "/history/search",
    supportsEventReplay: true,
    subscribedChannels: [
      IPC_CHANNELS.consoleOpen,
      IPC_CHANNELS.shellStatus
    ]
  };
}
