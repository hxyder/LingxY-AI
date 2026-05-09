export const TOOL_DISPLAY_LABELS = Object.freeze({
  web_search: "打开网页搜索",
  web_search_fetch: "搜索网页",
  fetch_url_content: "读取网页",
  search_file_content: "检索文件索引",
  read_file_text: "读取文件原文",
  read_folder_text: "读取文件夹原文",
  index_file_content: "写入文件索引",
  list_files: "列出文件",
  glob_files: "匹配文件",
  find_recent_files: "查找最近文件",
  stat_file: "读取文件信息",
  verify_file_exists: "确认文件存在",
  file_op: "文件操作",
  generate_document: "生成文档",
  write_file: "写入文件",
  edit_file: "编辑文件",
  render_diagram: "生成图表",
  render_svg: "生成矢量图",
  vision_analyze: "分析图片",
  launch_app: "启动应用",
  open_url: "打开网页",
  notify: "发送通知",
  create_scheduled_task: "创建定时任务",
  "Create Scheduled Task": "创建定时任务",
  list_scheduled_tasks: "读取定时任务",
  "List Scheduled Tasks": "读取定时任务",
  update_scheduled_task: "更新定时任务",
  "Update Scheduled Task": "更新定时任务",
  delete_scheduled_task: "删除定时任务",
  "Delete Scheduled Task": "删除定时任务",
  connector_workflow_run: "连接器流程",
  account_send_email: "发送邮件",
  send_email_smtp: "发送邮件",
  account_create_event: "创建日历事件",
  account_list_events: "读取日历",
  account_upload_file: "上传文件",
  account_list_emails: "读取邮件",
  account_list_files: "读取文件",
  google_gmail_send_email: "发送 Gmail",
  "google.gmail.send_email": "发送 Gmail",
  microsoft_outlook_send_email: "发送 Outlook 邮件",
  "microsoft.outlook.send_email": "发送 Outlook 邮件",
  google_calendar_create_event: "创建 Google 日历事件",
  "google.calendar.create_event": "创建 Google 日历事件",
  microsoft_calendar_create_event: "创建 Outlook 日历事件",
  "microsoft.calendar.create_event": "创建 Outlook 日历事件",
  draft_capability: "起草能力",
  save_capability_draft: "保存能力草稿"
});

export function compactToolText(value = "", max = 96) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function formatToolDisplayName(toolName = "") {
  const raw = String(toolName ?? "").trim();
  if (!raw) return "工具";
  return TOOL_DISPLAY_LABELS[raw] || raw.replace(/_/g, " ");
}

function pickFirstString(value, keys = []) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function coerceArgsObject(args) {
  if (args && typeof args === "object") return args;
  if (typeof args !== "string" || !args.trim()) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function formatTriggerPreview(trigger = {}) {
  if (!trigger || typeof trigger !== "object") return "";
  const type = String(trigger.type ?? trigger.trigger_type ?? "").trim();
  const at = trigger.run_at ?? trigger.at ?? trigger.next_run_at ?? "";
  const cron = trigger.cron ?? trigger.expression ?? "";
  const natural = trigger.natural_language ?? trigger.naturalLanguage ?? trigger.text ?? "";
  const timezone = trigger.timezone ?? trigger.time_zone ?? trigger.tz ?? "";
  if (type === "at" && at) return compactToolText(`一次 · ${at}`, 72);
  if (type === "cron" && cron) return compactToolText(`重复 · ${cron}`, 72);
  if (natural) {
    const suffix = timezone ? ` · ${timezone}` : "";
    return compactToolText(`时间 · ${natural}${suffix}`, 72);
  }
  if (type) return compactToolText(`时间 · ${type}`, 72);
  const fallback = at || cron || "";
  return fallback ? compactToolText(`时间 · ${fallback}`, 72) : "";
}

function formatActionPreview(action = {}) {
  if (!action || typeof action !== "object") return "";
  const params = action.params && typeof action.params === "object" ? action.params : {};
  return compactToolText(
    pickFirstString(action, ["target", "title", "message", "description"])
      || pickFirstString(params, ["userCommand", "command", "title", "message", "body", "contextText"]),
    84
  );
}

export function formatToolArgsPreview(toolName = "", args = {}) {
  const value = coerceArgsObject(args);
  const normalizedToolName = String(toolName ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (toolName === "web_search_fetch") {
    return value.query ? `query: ${compactToolText(value.query, 88)}` : "";
  }
  if (toolName === "fetch_url_content") {
    try {
      const url = new URL(String(value.url ?? ""));
      return compactToolText(`${url.hostname}${url.pathname}`, 92);
    } catch {
      return value.url ? compactToolText(value.url, 92) : "";
    }
  }
  if (toolName === "search_file_content") {
    return value.query ? `query: ${compactToolText(value.query, 88)}` : "";
  }
  if (toolName === "read_file_text") {
    return compactToolText(pickFirstString(value, ["path", "file_path", "filePath"]), 92);
  }
  if (toolName === "read_folder_text") {
    return compactToolText(pickFirstString(value, ["root", "dir", "path", "folder_path", "folderPath"]), 92);
  }
  if (toolName === "list_files" || toolName === "glob_files" || toolName === "find_recent_files") {
    return compactToolText(pickFirstString(value, ["dir", "root", "path", "pattern", "glob"]), 92);
  }
  if (toolName === "generate_document") {
    const kind = value.kind ? String(value.kind).toUpperCase() : "DOC";
    const outline = value.outline && typeof value.outline === "object" ? value.outline : {};
    const title = outline.title ?? value.filename ?? value.path ?? "";
    return compactToolText(`${kind}${title ? ` · ${title}` : ""}`, 92);
  }
  if (toolName === "launch_app") return value.app ? compactToolText(value.app, 80) : "";
  if (toolName === "open_url") return value.url ? compactToolText(value.url, 92) : "";
  if (toolName === "notify") {
    return compactToolText(pickFirstString(value, ["title", "body", "message"]), 92);
  }
  if (normalizedToolName === "create_scheduled_task") {
    const name = pickFirstString(value, ["name", "title", "description"]);
    const trigger = formatTriggerPreview(value.trigger);
    const action = formatActionPreview(value.action);
    return compactToolText([
      name ? `任务 · ${name}` : "",
      trigger,
      action ? `动作 · ${action}` : ""
    ].filter(Boolean).join(" · "), 110);
  }
  if (normalizedToolName === "update_scheduled_task" || normalizedToolName === "delete_scheduled_task") {
    return compactToolText(pickFirstString(value, ["schedule_id", "id", "name", "title"]), 92);
  }
  if (normalizedToolName === "list_scheduled_tasks") return "";
  if (toolName === "draft_capability") {
    const kind = value.kind ?? value.state?.kind ?? "capability";
    const name = value.name ?? value.state?.name ?? "";
    if (value.answer?.field) return compactToolText(`${kind} · answer ${value.answer.field}`, 92);
    return compactToolText(`${kind}${name ? ` · ${name}` : ""}`, 92);
  }
  if (toolName === "save_capability_draft") {
    const draft = value.draft && typeof value.draft === "object" ? value.draft : {};
    const state = value.state && typeof value.state === "object" ? value.state : {};
    const kind = draft.kind ?? state.kind ?? "capability";
    const name = draft.name ?? state.name ?? "";
    return compactToolText(`${kind}${name ? ` · ${name}` : ""}`, 92);
  }
  const summary = pickFirstString(value, [
    "name",
    "title",
    "query",
    "path",
    "url",
    "description",
    "message"
  ]);
  return summary ? compactToolText(summary, 110) : "参数已折叠";
}
