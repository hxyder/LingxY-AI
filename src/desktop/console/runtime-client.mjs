import pricing from "../../service/cost/pricing.json" with { type: "json" };
import { createConsoleViewModel } from "./view-model.mjs";
import { buildPendingApprovalsViewModel } from "./pending-approvals/view-model.mjs";
import { buildSchedulesViewModel } from "./schedules/view-model.mjs";
import { buildBudgetDashboardViewModel } from "./budget_dashboard/view-model.mjs";
import { buildHistorySearchViewModel } from "./history_search/view-model.mjs";
import { buildAuditLogViewerModel } from "./audit_log_viewer/view-model.mjs";
import { buildConsoleFiltersViewModel } from "./filters/view-model.mjs";
import { buildTaskDetailViewModel } from "./task-detail/view-model.mjs";
import { buildTemplateEditorViewModel } from "./template_editor/view-model.mjs";
import { buildDagConsoleViewModel } from "./dag_view/view-model.mjs";

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
    getTaskEvents(taskId, since = null) {
      const search = since ? `?since=${encodeURIComponent(since)}` : "";
      return fetchJson(`/task/${encodeURIComponent(taskId)}/events${search}`);
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
    updateBudget(limits) {
      return fetchJson("/budget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lingxy-Desktop-Actor": "desktop_console"
        },
        body: JSON.stringify({ limits })
      });
    },
    updateSecurityState(patch) {
      return fetchJson("/security/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lingxy-Desktop-Actor": "desktop_console"
        },
        body: JSON.stringify(patch ?? {})
      });
    },
    getAuditLog() {
      return fetchJson("/audit-log");
    },
    getTemplates() {
      return fetchJson("/templates");
    },
    getTemplate(templateId) {
      return fetchJson(`/templates/${encodeURIComponent(templateId)}`);
    },
    saveTemplate(template, actor = "console") {
      return fetchJson("/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actor,
          template
        })
      });
    },
    importTemplate(raw, actor = "console_import") {
      return fetchJson("/templates/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actor,
          raw
        })
      });
    },
    exportTemplate(templateId) {
      return fetchJson(`/templates/${encodeURIComponent(templateId)}/export`);
    },
    deleteTemplate(templateId) {
      return fetchJson(`/templates/${encodeURIComponent(templateId)}`, {
        method: "DELETE"
      });
    },
    validateTemplate(template) {
      return fetchJson("/templates/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          template
        })
      });
    },
    previewDag(graph) {
      return fetchJson("/dag/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          graph
        })
      });
    },
    getDagExecutions() {
      return fetchJson("/dag/executions");
    },
    getDagExecution(executionId) {
      return fetchJson(`/dag/executions/${encodeURIComponent(executionId)}`);
    },
    resumeDagExecution(executionId) {
      return fetchJson(`/dag/executions/${encodeURIComponent(executionId)}/resume`, {
        method: "POST"
      });
    },
    getProviders() {
      return fetchJson("/ai/providers");
    },
    getCodeCliAdapters() {
      return fetchJson("/ai/code-cli");
    },
    getMcpServers() {
      return fetchJson("/ai/mcp");
    },
    getSkillRegistries() {
      return fetchJson("/ai/skills");
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
    cancelTask(taskId) {
      return fetchJson(`/task/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST"
      });
    },
    retryTask(taskId, {
      mode = "retry_same",
      overrides = {}
    } = {}) {
      return fetchJson(`/task/${encodeURIComponent(taskId)}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode,
          overrides
        })
      });
    },
    approveApproval(approvalId, options = {}) {
      return fetchJson(`/approvals/${encodeURIComponent(approvalId)}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lingxy-Desktop-Actor": "desktop_console"
        },
        body: JSON.stringify({
          actor: "desktop_console",
          ...options
        })
      });
    },
    rejectApproval(approvalId, options = {}) {
      return fetchJson(`/approvals/${encodeURIComponent(approvalId)}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lingxy-Desktop-Actor": "desktop_console"
        },
        body: JSON.stringify({
          actor: "desktop_console",
          ...options
        })
      });
    },
    runScheduleNow(scheduleId, triggerPayload = {}) {
      return fetchJson(`/schedules/${encodeURIComponent(scheduleId)}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lingxy-Desktop-Actor": "desktop_console"
        },
        body: JSON.stringify({
          triggerPayload
        })
      });
    },
    async loadTaskDetail(taskId) {
      const payload = await this.getTask(taskId);
      return {
        raw: payload,
        viewModel: buildTaskDetailViewModel(
          payload.task,
          payload.events ?? [],
          payload.artifacts ?? []
        )
      };
    },
    subscribeTaskEvents(taskId, {
      since = null,
      onEvent = () => {},
      signal = null
    } = {}) {
      const controller = new AbortController();
      const cleanup = [];
      if (signal) {
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        cleanup.push(() => signal.removeEventListener("abort", abort));
      }

      const promise = (async () => {
        const search = since ? `?since=${encodeURIComponent(since)}` : "";
        const response = await fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}/events${search}`, {
          headers: {
            Accept: "text/event-stream"
          },
          signal: controller.signal
        });
        if (!response.ok || !response.body) {
          throw new Error(`Failed to subscribe task events: ${taskId}`);
        }

        const decoder = new TextDecoder();
        let buffer = "";

        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseSseFrame(frame);
            if (parsed) {
              onEvent(parsed);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      })().catch((error) => {
        if (error.name === "AbortError") {
          return null;
        }
        throw error;
      }).finally(() => {
        for (const release of cleanup) {
          release();
        }
      });

      return {
        close() {
          controller.abort();
        },
        promise
      };
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
        templatesPayload,
        dagExecutionsPayload,
        providersPayload,
        codeCliPayload,
        mcpPayload,
        skillsPayload,
        historyPayload
      ] = await Promise.all([
        this.getHealth(),
        this.getTasks(),
        this.getApprovals(),
        this.getSchedules(),
        this.getBudget(),
        this.getAuditLog(),
        this.getTemplates(),
        this.getDagExecutions(),
        this.getProviders(),
        this.getCodeCliAdapters(),
        this.getMcpServers(),
        this.getSkillRegistries(),
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
          templates: templatesPayload.templates ?? [],
          dagExecutions: dagExecutionsPayload.executions ?? [],
          providers: providersPayload.providers ?? [],
          codeCliAdapters: codeCliPayload.adapters ?? [],
          mcpServers: mcpPayload.servers ?? [],
          skillRegistries: skillsPayload.registries ?? [],
          skills: skillsPayload.skills ?? [],
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
          templateEditor: buildTemplateEditorViewModel({
            templates: templatesPayload.templates ?? [],
            selectedTemplateId: templatesPayload.templates?.[0]?.id ?? null
          }),
          dag: buildDagConsoleViewModel(
            dagExecutionsPayload.executions?.[0]?.graph ?? {
              nodes: [],
              edges: []
            },
            dagExecutionsPayload.executions?.[0] ?? null
          ),
          history: buildHistorySearchViewModel(historyQuery, historyPayload.results ?? []),
          audit: buildAuditLogViewerModel(auditPayload.entries ?? [])
        }
      };
    }
  };
}

function parseSseFrame(frame) {
  const parsed = {
    id: null,
    event: "message",
    data: null
  };
  for (const line of frame.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith("id:")) {
      parsed.id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      parsed.event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      const payloadText = line.slice(5).trim();
      parsed.data = payloadText ? JSON.parse(payloadText) : null;
    }
  }

  if (!parsed.id && !parsed.data) {
    return null;
  }

  return parsed;
}
