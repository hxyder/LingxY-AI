import pricing from "../../service/cost/pricing.json" with { type: "json" };
import { createConsoleViewModel } from "./view-model.mjs";
import { buildPendingApprovalsViewModel } from "./pending-approvals/view-model.mjs";
import { buildSchedulesViewModel } from "./schedules/view-model.mjs";
import { buildBudgetDashboardViewModel } from "./budget_dashboard/view-model.mjs";
import { buildHistorySearchViewModel } from "./history_search/view-model.mjs";
import { buildAuditLogViewerModel } from "./audit_log_viewer/view-model.mjs";
import { buildConsoleFiltersViewModel } from "./filters/view-model.mjs";

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export function createConsoleRuntimeClient(serviceBaseUrl) {
  const baseUrl = serviceBaseUrl.replace(/\/+$/, "");

  async function fetchJson(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.message ?? payload.error ?? `Request failed: ${pathname}`);
    }
    return payload;
  }

  return {
    serviceBaseUrl: baseUrl,
    fetchJson,
    getHealth() {
      return fetchJson("/health");
    },
    getTasks() {
      return fetchJson("/tasks");
    },
    getTask(taskId) {
      return fetchJson(`/task/${encodeURIComponent(taskId)}`);
    },
    getApprovals() {
      return fetchJson("/approvals");
    },
    getSchedules() {
      return fetchJson("/schedules");
    },
    getScheduleRuns(scheduleId) {
      return fetchJson(`/schedules/${encodeURIComponent(scheduleId)}/runs`);
    },
    getBudget() {
      return fetchJson("/budget");
    },
    getAuditLog() {
      return fetchJson("/audit-log");
    },
    getProviders() {
      return fetchJson("/ai/providers");
    },
    getCodeCliAdapters() {
      return fetchJson("/ai/code-cli");
    },
    async searchHistory(query, limit = 5) {
      return fetchJson("/history/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, limit })
      });
    },
    async loadWorkspaceSnapshot({
      historyQuery = "",
      historyLimit = 5
    } = {}) {
      const [
        health,
        tasksPayload,
        approvalsPayload,
        schedulesPayload,
        budgetPayload,
        auditPayload,
        providersPayload,
        codeCliPayload,
        historyPayload
      ] = await Promise.all([
        this.getHealth(),
        this.getTasks(),
        this.getApprovals(),
        this.getSchedules(),
        this.getBudget(),
        this.getAuditLog(),
        this.getProviders(),
        this.getCodeCliAdapters(),
        this.searchHistory(historyQuery, historyLimit)
      ]);

      const schedules = schedulesPayload.schedules ?? [];
      const scheduleRunsPayload = await Promise.all(
        schedules.map((schedule) => this.getScheduleRuns(schedule.schedule_id))
      );
      const scheduleRuns = scheduleRunsPayload.flatMap((payload) => payload.runs ?? []);

      return {
        raw: {
          health,
          tasks: tasksPayload.tasks ?? [],
          approvals: approvalsPayload.approvals ?? [],
          schedules,
          scheduleRuns,
          budget: budgetPayload.budget ?? null,
          audit: auditPayload.entries ?? [],
          providers: providersPayload.providers ?? [],
          codeCliAdapters: codeCliPayload.adapters ?? [],
          history: historyPayload.results ?? []
        },
        viewModels: {
          console: createConsoleViewModel({
            tasks: tasksPayload.tasks ?? [],
            budgetState: budgetPayload.budget ?? null,
            health,
            codeCliAdapters: codeCliPayload.adapters ?? [],
            providers: providersPayload.providers ?? []
          }),
          filters: buildConsoleFiltersViewModel(tasksPayload.tasks ?? []),
          approvals: buildPendingApprovalsViewModel(approvalsPayload.approvals ?? []),
          schedules: buildSchedulesViewModel(schedules, scheduleRuns),
          budget: buildBudgetDashboardViewModel({
            budgetState: budgetPayload.budget ?? null,
            pricingEntries: Object.entries(pricing.executors)
          }),
          history: buildHistorySearchViewModel(historyQuery, historyPayload.results ?? []),
          audit: buildAuditLogViewerModel(auditPayload.entries ?? [])
        }
      };
    }
  };
}
