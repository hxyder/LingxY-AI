export const TOOL_DISPLAY_LABELS = Object.freeze({
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
  connector_workflow_run: "连接器流程",
  account_send_email: "发送邮件",
  account_upload_file: "上传文件",
  account_list_emails: "读取邮件",
  account_list_files: "读取文件"
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

export function formatToolArgsPreview(toolName = "", args = {}) {
  const value = args && typeof args === "object" ? args : {};
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
  const raw = typeof args === "string"
    ? args
    : (args == null ? "" : JSON.stringify(args, null, 0));
  return compactToolText(raw, 110);
}
