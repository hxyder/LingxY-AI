import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { resumeDagGraph, validateDagDefinition } from "../../dag/scheduler.mjs";
import { normalizeTemplateDocument } from "../../templates/parser.mjs";
import { validateTemplateDocument } from "../../templates/schema.mjs";
import { parseRelativeTime, formatRelativeDuration } from "../../utils/time-parser.mjs";
import { buildSideEffectContract } from "../policy/side-effect-contracts.mjs";

async function resumeDagExecution(runtime, executionId) {
  return resumeDagGraph({
    checkpointStore: runtime.platform.dagCheckpointStore,
    executionId,
    async executeNode(node, context) {
      return {
        nodeId: node.id,
        target: node.target ?? node.executor ?? null,
        resumed: true,
        previousCount: Object.keys(context.results ?? {}).length
      };
    }
  });
}

function normalizeScheduleTriggerRequest(trigger = {}) {
  if (trigger.type === "cron") {
    return {
      type: "cron",
      expression: trigger.expression ?? trigger.cron ?? "0 9 * * *",
      timezone: trigger.timezone ?? "Asia/Shanghai"
    };
  }

  if (trigger.type === "interval") {
    return {
      type: "interval",
      seconds: Number(trigger.seconds ?? 60)
    };
  }

  if (trigger.type === "at") {
    const runAt = new Date(trigger.run_at ?? trigger.at ?? "");
    if (Number.isNaN(runAt.getTime())) {
      throw new Error("At schedule trigger requires a valid run_at timestamp.");
    }
    return {
      type: "at",
      run_at: runAt.toISOString(),
      timezone: trigger.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
    };
  }

  return trigger;
}

function buildScheduleActionRequest(body = {}) {
  if (body.action?.type && body.action?.target) {
    return body.action;
  }

  const message = body.message ?? body.userCommand ?? body.command ?? "时间到了";
  return {
    type: "action_tool",
    target: "notify",
    params: {
      title: body.title ?? body.name ?? "UCA 提醒",
      body: message
    }
  };
}

export async function tryHandleSchedulerTemplateRoute({ request, response, method, url, runtime }) {
  const scheduleRunsMatch = url.pathname.match(/^\/schedules\/([^/]+)\/runs$/);
  const scheduleMatch = url.pathname.match(/^\/schedules\/([^/]+)$/);
  const templateExportMatch = url.pathname.match(/^\/templates\/([^/]+)\/export$/);
  const templateMatch = url.pathname.match(/^\/templates\/([^/]+)$/);
  const dagExecutionMatch = url.pathname.match(/^\/dag\/executions\/([^/]+)$/);
  const dagResumeMatch = url.pathname.match(/^\/dag\/executions\/([^/]+)\/resume$/);

  if (method === "GET" && url.pathname === "/schedules") {
    sendJson(response, 200, {
      schedules: runtime.scheduler.listSchedules()
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/schedules") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) return true;
    const body = await readJsonBody(request);
    try {
      const trigger = body.trigger?.natural_language
        ? body.trigger
        : normalizeScheduleTriggerRequest(body.trigger ?? {
          type: "cron",
          expression: body.cron ?? "0 9 * * *"
        });
      const action = buildScheduleActionRequest(body);
      const schedule = runtime.scheduler.createSchedule({
        name: body.name ?? "Unnamed schedule",
        description: body.description ?? "",
        trigger,
        action,
        executionMode: body.executionMode ?? "unattended_safe",
        catchupPolicy: body.catchupPolicy ?? body.catchup_policy ?? "skip",
        enabled: body.enabled !== false,
        category: body.category ?? body.metadata?.category ?? "general",
        color: body.color ?? body.metadata?.color ?? null,
        leadTimeMs: body.leadTimeMs ?? body.lead_time_ms ?? null,
        userTodo: Boolean(body.userTodo ?? body.user_todo ?? false),
        metadata: {
          ...(body.metadata ?? {}),
          one_shot: Boolean(body.oneShot ?? body.one_shot ?? trigger.oneShot)
        }
      }, { createdBy: actor });

      const now = new Date();
      let timeInfo = null;
      const sourceText = body.userCommand ?? body.message ?? body.name ?? "";
      if (trigger.type === "at" && trigger.run_at) {
        const diffMs = new Date(trigger.run_at).getTime() - now.getTime();
        timeInfo = {
          ts: trigger.run_at,
          display: new Date(trigger.run_at).toLocaleString("zh-CN", { hour12: false }),
          diffMs,
          relativeLabel: formatRelativeDuration(diffMs)
        };
      } else if (sourceText) {
        timeInfo = parseRelativeTime(sourceText, now);
      }

      sendJson(response, 200, { schedule, timeInfo });
      return true;
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return true;
    }
  }

  if (scheduleMatch && method === "DELETE") {
    if (!requireDesktopActor({ request, response })) return true;
    const deleted = runtime.scheduler.deleteSchedule(scheduleMatch[1]);
    if (!deleted) {
      sendJson(response, 404, { error: "schedule_not_found" });
      return true;
    }
    sendJson(response, 200, { deleted });
    return true;
  }

  if (scheduleMatch && method === "PATCH") {
    if (!requireDesktopActor({ request, response })) return true;
    const body = await readJsonBody(request);
    const scheduleId = scheduleMatch[1];
    let schedule = null;
    if (typeof body?.name === "string") {
      const existing = runtime.store.getSchedule(scheduleId);
      if (!existing) {
        sendJson(response, 404, { error: "schedule_not_found" });
        return true;
      }
      existing.name = body.name.trim().slice(0, 120) || existing.name;
      existing.updated_at = new Date().toISOString();
      runtime.store.updateSchedule(scheduleId, existing);
      schedule = existing;
    }
    if (body?.trigger && typeof body.trigger === "object") {
      try {
        schedule = runtime.scheduler.rescheduleSchedule(scheduleId, body.trigger);
        if (!schedule) {
          sendJson(response, 404, { error: "schedule_not_found" });
          return true;
        }
      } catch (error) {
        sendJson(response, 400, { error: error?.message ?? "trigger_invalid" });
        return true;
      }
    }
    const actionCommand = typeof body?.userCommand === "string"
      ? body.userCommand
      : typeof body?.actionCommand === "string"
        ? body.actionCommand
        : null;
    if (typeof body?.description === "string" || actionCommand !== null) {
      const existing = schedule ?? runtime.store.getSchedule(scheduleId);
      if (!existing) {
        sendJson(response, 404, { error: "schedule_not_found" });
        return true;
      }
      if (typeof body.description === "string") {
        existing.description = body.description.trim().slice(0, 2000);
      }
      if (actionCommand !== null) {
        if (existing.action_type !== "task") {
          sendJson(response, 400, { error: "schedule_action_not_editable" });
          return true;
        }
        const command = actionCommand.trim();
        if (!command) {
          sendJson(response, 400, { error: "schedule_action_command_required" });
          return true;
        }
        existing.action_params = {
          ...(existing.action_params ?? {}),
          userCommand: command,
          contextText: typeof body.contextText === "string"
            ? body.contextText
            : command
        };
        existing.action_target = typeof body.actionTarget === "string" && body.actionTarget.trim()
          ? body.actionTarget.trim().slice(0, 120)
          : command.slice(0, 120);
      }
      const contractSources = actionCommand !== null
        ? [
            existing.action_params?.userCommand,
            existing.action_params?.contextText
          ].filter(Boolean)
        : [
            existing.name,
            existing.description,
            existing.action_target,
            existing.action_params?.userCommand,
            existing.action_params?.contextText
          ].filter(Boolean);
      const rebuiltContract = buildSideEffectContract({
        runtime,
        inferPolicyGroups: true,
        sources: contractSources,
        task: {
          user_command: existing.action_params?.userCommand ?? existing.action_target,
          context_packet: {
            text: contractSources.join("\n"),
            file_paths: existing.action_params?.file_paths ?? existing.action_params?.filePaths ?? [],
            selection_metadata: {}
          }
        }
      });
      if (rebuiltContract) {
        existing.metadata = {
          ...(existing.metadata ?? {}),
          side_effect_contract: rebuiltContract
        };
      } else if (existing.metadata?.side_effect_contract) {
        const { side_effect_contract: _removed, ...rest } = existing.metadata;
        existing.metadata = rest;
      }
      existing.updated_at = new Date().toISOString();
      runtime.store.updateSchedule(scheduleId, existing);
      schedule = existing;
    }
    if (typeof body?.enabled === "boolean") {
      schedule = runtime.scheduler.pauseSchedule(scheduleId, body.enabled);
    }
    if (!schedule) {
      schedule = runtime.store.getSchedule(scheduleId);
    }
    if (!schedule) {
      sendJson(response, 404, { error: "schedule_not_found" });
      return true;
    }
    sendJson(response, 200, { schedule });
    return true;
  }

  if (scheduleRunsMatch && method === "GET") {
    sendJson(response, 200, {
      schedule_id: scheduleRunsMatch[1],
      runs: runtime.store.listScheduleRuns(scheduleRunsMatch[1])
    });
    return true;
  }

  if (scheduleRunsMatch && method === "POST") {
    if (!requireDesktopActor({ request, response })) return true;
    const body = await readJsonBody(request);
    const result = await runtime.scheduler.dispatch(scheduleRunsMatch[1], "manual", body.triggerPayload ?? {});
    if (!result) {
      sendJson(response, 404, { error: "schedule_not_found" });
      return true;
    }
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/templates") {
    sendJson(response, 200, {
      templates: runtime.platform.templateRegistry.list()
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/templates") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) return true;
    const body = await readJsonBody(request);
    const result = runtime.platform.templateRegistry.save(body.template ?? body, {
      actor
    });
    sendJson(response, result.ok ? 200 : 400, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/templates/import") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) return true;
    const body = await readJsonBody(request);
    const result = runtime.platform.templateRegistry.import(body.template ?? body.raw ?? body, {
      actor
    });
    sendJson(response, result.ok ? 200 : 400, result);
    return true;
  }

  if (templateExportMatch && method === "GET") {
    const templateId = decodeURIComponent(templateExportMatch[1]);
    const raw = runtime.platform.templateRegistry.export(templateId);
    if (!raw) {
      sendJson(response, 404, { error: "template_not_found" });
      return true;
    }
    sendJson(response, 200, {
      template_id: templateId,
      raw
    });
    return true;
  }

  if (templateMatch && method === "GET") {
    const templateId = decodeURIComponent(templateMatch[1]);
    const template = runtime.platform.templateRegistry.get(templateId);
    if (!template) {
      sendJson(response, 404, { error: "template_not_found" });
      return true;
    }
    sendJson(response, 200, { template });
    return true;
  }

  if (templateMatch && method === "DELETE") {
    if (!requireDesktopActor({ request, response })) return true;
    const templateId = decodeURIComponent(templateMatch[1]);
    const removed = runtime.platform.templateRegistry.remove(templateId);
    if (!removed) {
      sendJson(response, 404, { error: "template_not_found_or_builtin" });
      return true;
    }
    sendJson(response, 200, { removed });
    return true;
  }

  if (method === "POST" && url.pathname === "/templates/validate") {
    const body = await readJsonBody(request);
    const template = normalizeTemplateDocument(body.template ?? body);
    sendJson(response, 200, {
      template,
      validation: validateTemplateDocument(template)
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/dag/preview") {
    const body = await readJsonBody(request);
    const graph = body.graph ?? body;
    sendJson(response, 200, {
      graph,
      validation: validateDagDefinition(graph)
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/dag/executions") {
    sendJson(response, 200, {
      executions: runtime.platform.dagCheckpointStore.list()
    });
    return true;
  }

  if (dagExecutionMatch && method === "GET") {
    const executionId = decodeURIComponent(dagExecutionMatch[1]);
    const execution = runtime.platform.dagCheckpointStore.get(executionId);
    if (!execution) {
      sendJson(response, 404, { error: "dag_execution_not_found" });
      return true;
    }
    sendJson(response, 200, { execution });
    return true;
  }

  if (dagResumeMatch && method === "POST") {
    if (!requireDesktopActor({ request, response })) return true;
    const executionId = decodeURIComponent(dagResumeMatch[1]);
    const execution = runtime.platform.dagCheckpointStore.get(executionId);
    if (!execution) {
      sendJson(response, 404, { error: "dag_execution_not_found" });
      return true;
    }
    const resumed = await resumeDagExecution(runtime, executionId);
    sendJson(response, 200, {
      execution: resumed
    });
    return true;
  }

  return false;
}
