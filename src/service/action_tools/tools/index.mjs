import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createNoopTool, writeToolArtifact } from "../tool-helper.mjs";
import { createActionResult } from "../types.mjs";

const TOOL_DEFINITIONS = [
  {
    id: "open_url",
    name: "Open URL",
    description: "Open a URL in the user's default browser.",
    parameters: ACTION_TOOL_SCHEMAS.open_url,
    risk_level: "low",
    required_capabilities: ["network"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Opened URL ${args.url}`;
    }
  },
  {
    id: "web_search",
    name: "Web Search",
    description: "Open a search results page with the user's preferred engine.",
    parameters: ACTION_TOOL_SCHEMAS.web_search,
    risk_level: "low",
    required_capabilities: ["network"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Opened web search for "${args.query}"`;
    }
  },
  {
    id: "compose_email",
    name: "Compose Email",
    description: "Open a mail draft with prefilled recipients, subject, and body.",
    parameters: ACTION_TOOL_SCHEMAS.compose_email,
    risk_level: "low",
    required_capabilities: ["launch_app"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Prepared a draft email to ${(args.to ?? []).join(", ")}`;
    }
  },
  {
    id: "send_email_smtp",
    name: "Send Email SMTP",
    description: "Send an email directly over SMTP using user configuration.",
    parameters: ACTION_TOOL_SCHEMAS.send_email_smtp,
    risk_level: "high",
    required_capabilities: ["network"],
    requires_confirmation: true,
    formatObservation(args) {
      return `Sent SMTP email to ${(args.to ?? []).join(", ")}`;
    }
  },
  {
    id: "open_file",
    name: "Open File",
    description: "Open a local file with the associated application.",
    parameters: ACTION_TOOL_SCHEMAS.open_file,
    risk_level: "medium",
    required_capabilities: ["file_read", "launch_app"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Opened file ${args.path}`;
    }
  },
  {
    id: "reveal_in_explorer",
    name: "Reveal In Explorer",
    description: "Reveal a local file in Explorer.",
    parameters: ACTION_TOOL_SCHEMAS.reveal_in_explorer,
    risk_level: "low",
    required_capabilities: ["file_read"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Revealed ${args.path} in Explorer`;
    }
  },
  {
    id: "launch_app",
    name: "Launch App",
    description: "Launch an allowed local application.",
    parameters: ACTION_TOOL_SCHEMAS.launch_app,
    risk_level: "medium",
    required_capabilities: ["launch_app"],
    requires_confirmation: true,
    formatObservation(args) {
      return `Launched app ${args.app}`;
    }
  },
  {
    id: "copy_to_clipboard",
    name: "Copy To Clipboard",
    description: "Write text to the system clipboard.",
    parameters: ACTION_TOOL_SCHEMAS.copy_to_clipboard,
    risk_level: "low",
    required_capabilities: ["clipboard_write"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Copied ${String(args.content).length} characters to the clipboard`;
    }
  },
  {
    id: "notify",
    name: "Notify",
    description: "Show a local toast notification.",
    parameters: ACTION_TOOL_SCHEMAS.notify,
    risk_level: "low",
    required_capabilities: ["notify"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Displayed notification "${args.title}"`;
    }
  },
  {
    id: "read_clipboard",
    name: "Read Clipboard",
    description: "Read the current clipboard content.",
    parameters: ACTION_TOOL_SCHEMAS.read_clipboard,
    risk_level: "medium",
    required_capabilities: ["clipboard_read"],
    requires_confirmation: false,
    formatObservation(_, ctx) {
      return `Read clipboard contents: ${ctx.clipboardText ?? ""}`;
    }
  }
];

const NOOP_TOOLS = TOOL_DEFINITIONS.map((definition) => createNoopTool(definition));

export const OPEN_URL_TOOL = NOOP_TOOLS.find((tool) => tool.id === "open_url");
export const WEB_SEARCH_TOOL = NOOP_TOOLS.find((tool) => tool.id === "web_search");
export const COMPOSE_EMAIL_TOOL = NOOP_TOOLS.find((tool) => tool.id === "compose_email");
export const SEND_EMAIL_SMTP_TOOL = NOOP_TOOLS.find((tool) => tool.id === "send_email_smtp");
export const OPEN_FILE_TOOL = NOOP_TOOLS.find((tool) => tool.id === "open_file");
export const REVEAL_IN_EXPLORER_TOOL = NOOP_TOOLS.find((tool) => tool.id === "reveal_in_explorer");
export const LAUNCH_APP_TOOL = NOOP_TOOLS.find((tool) => tool.id === "launch_app");
export const COPY_TO_CLIPBOARD_TOOL = NOOP_TOOLS.find((tool) => tool.id === "copy_to_clipboard");
export const NOTIFY_TOOL = NOOP_TOOLS.find((tool) => tool.id === "notify");
export const READ_CLIPBOARD_TOOL = NOOP_TOOLS.find((tool) => tool.id === "read_clipboard");

export const FILE_OP_TOOL = {
  id: "file_op",
  name: "File Operation",
  description: "Perform a constrained file operation in the allowed workspace.",
  parameters: ACTION_TOOL_SCHEMAS.file_op,
  risk_level: "high",
  required_capabilities: ["file_write"],
  requires_confirmation: true,
  async execute(args) {
    return createActionResult({
      success: true,
      observation: `Prepared file operation ${args.operation} for ${args.path}`,
      metadata: {
        operation: args.operation,
        targetPath: args.targetPath ?? null
      }
    });
  }
};

export const TAKE_SCREENSHOT_TOOL = {
  id: "take_screenshot",
  name: "Take Screenshot",
  description: "Capture a screenshot and save it as an artifact.",
  parameters: ACTION_TOOL_SCHEMAS.take_screenshot,
  risk_level: "low",
  required_capabilities: ["screenshot"],
  requires_confirmation: false,
  async execute(args, ctx) {
    const artifactPath = await writeToolArtifact(ctx, `${args.label.replace(/[^a-z0-9_-]/gi, "_")}.txt`, "screenshot placeholder");
    return createActionResult({
      success: true,
      observation: `Captured screenshot artifact ${artifactPath}`,
      artifactPaths: [artifactPath]
    });
  }
};

function getSchedulerRuntime(ctx) {
  const scheduler = ctx.runtime?.scheduler;
  if (!scheduler) {
    throw new Error("Scheduler runtime is unavailable.");
  }
  return scheduler;
}

export const CREATE_SCHEDULED_TASK_TOOL = {
  id: "create_scheduled_task",
  name: "Create Scheduled Task",
  description: "Create a cron, interval, or file-watch schedule.",
  parameters: ACTION_TOOL_SCHEMAS.create_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedule = scheduler.createSchedule({
      name: args.name,
      description: args.description ?? "",
      trigger: args.trigger,
      action: args.action,
      executionMode: args.execution_mode ?? "unattended_safe",
      catchupPolicy: args.catchup_policy ?? "skip"
    }, {
      createdBy: ctx.task ? "agent" : "user"
    });

    return createActionResult({
      success: true,
      observation: `Created schedule ${schedule.schedule_id}`,
      metadata: {
        schedule_id: schedule.schedule_id,
        next_run_at: schedule.next_run_at
      }
    });
  }
};

export const LIST_SCHEDULED_TASKS_TOOL = {
  id: "list_scheduled_tasks",
  name: "List Scheduled Tasks",
  description: "List configured schedules and their current status.",
  parameters: ACTION_TOOL_SCHEMAS.list_scheduled_tasks,
  risk_level: "low",
  required_capabilities: ["schedule_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedules = scheduler.listSchedules()
      .filter((schedule) => args.includeDisabled || schedule.enabled);
    return createActionResult({
      success: true,
      observation: `Listed ${schedules.length} schedules`,
      metadata: {
        schedules
      }
    });
  }
};

export const DELETE_SCHEDULED_TASK_TOOL = {
  id: "delete_scheduled_task",
  name: "Delete Scheduled Task",
  description: "Delete a schedule and its active registrations.",
  parameters: ACTION_TOOL_SCHEMAS.delete_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const deleted = scheduler.deleteSchedule(args.schedule_id);
    return createActionResult({
      success: Boolean(deleted),
      observation: deleted ? `Deleted schedule ${args.schedule_id}` : `Schedule ${args.schedule_id} not found`,
      metadata: {
        schedule_id: args.schedule_id
      },
      error: deleted ? null : "schedule_not_found"
    });
  }
};

export const PAUSE_SCHEDULED_TASK_TOOL = {
  id: "pause_scheduled_task",
  name: "Pause Scheduled Task",
  description: "Pause or resume a schedule.",
  parameters: ACTION_TOOL_SCHEMAS.pause_scheduled_task,
  risk_level: "medium",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: false,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedule = scheduler.pauseSchedule(args.schedule_id, args.enabled ?? false);
    return createActionResult({
      success: Boolean(schedule),
      observation: schedule
        ? `${schedule.enabled ? "Resumed" : "Paused"} schedule ${args.schedule_id}`
        : `Schedule ${args.schedule_id} not found`,
      metadata: {
        schedule_id: args.schedule_id,
        enabled: schedule?.enabled ?? null
      },
      error: schedule ? null : "schedule_not_found"
    });
  }
};

export const BUILTIN_ACTION_TOOLS = Object.freeze([
  OPEN_URL_TOOL,
  WEB_SEARCH_TOOL,
  COMPOSE_EMAIL_TOOL,
  SEND_EMAIL_SMTP_TOOL,
  OPEN_FILE_TOOL,
  REVEAL_IN_EXPLORER_TOOL,
  LAUNCH_APP_TOOL,
  COPY_TO_CLIPBOARD_TOOL,
  NOTIFY_TOOL,
  FILE_OP_TOOL,
  TAKE_SCREENSHOT_TOOL,
  READ_CLIPBOARD_TOOL,
  CREATE_SCHEDULED_TASK_TOOL,
  LIST_SCHEDULED_TASKS_TOOL,
  DELETE_SCHEDULED_TASK_TOOL,
  PAUSE_SCHEDULED_TASK_TOOL
]);
