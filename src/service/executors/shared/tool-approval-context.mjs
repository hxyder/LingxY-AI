const FILE_CONTENT_INDEX_TOOL_ID = "index_file_content";
const FILE_TEXT_TOOLS = new Set(["read_file_text", "read_folder_text"]);
const MAX_DEFERRED_TRANSCRIPT_ENTRIES = 20;

function normalizeFileReadTranscriptEntry(entry = {}) {
  const toolId = entry?.type === "tool_result"
    ? entry.tool
    : entry?.role === "tool"
      ? entry.name
      : null;
  if (!FILE_TEXT_TOOLS.has(toolId)) return null;
  if (entry.success !== true) return null;
  return {
    type: "tool_result",
    tool: toolId,
    success: true,
    observation: entry.observation ?? "",
    metadata: entry.metadata ?? {},
    artifact_paths: Array.isArray(entry.artifact_paths) ? entry.artifact_paths.filter(Boolean) : []
  };
}

function extractPathFromEntry(entry = {}) {
  const metadata = entry.metadata ?? {};
  if (typeof metadata.path === "string" && metadata.path.trim()) return metadata.path.trim();
  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const first = files.find((file) => typeof file?.path === "string" && file.path.trim());
  return first?.path?.trim() ?? null;
}

function buildIndexFileContentDeferredContext(transcript = []) {
  const entries = [];
  for (const entry of Array.isArray(transcript) ? transcript : []) {
    const normalized = normalizeFileReadTranscriptEntry(entry);
    if (!normalized) continue;
    entries.push(normalized);
    if (entries.length >= MAX_DEFERRED_TRANSCRIPT_ENTRIES) break;
  }
  if (entries.length === 0) return null;
  return { transcript: entries };
}

function previewIndexFileContent(deferredContext = null) {
  const entries = Array.isArray(deferredContext?.transcript) ? deferredContext.transcript : [];
  const paths = entries.map(extractPathFromEntry).filter(Boolean);
  const lines = [
    "Index file content for future retrieval",
    `${entries.length} prior file read${entries.length === 1 ? "" : "s"} will be stored in the file-content index.`
  ];
  for (const filePath of paths.slice(0, 8)) {
    lines.push(`- ${filePath}`);
  }
  if (paths.length > 8) lines.push(`+${paths.length - 8} more path${paths.length - 8 === 1 ? "" : "s"}`);
  if (entries.length === 0) {
    lines.push("No prior file text read is available yet; approve only after the task has read the intended files.");
  }
  return lines.join("\n");
}

export function buildDeferredToolContext({ tool, transcript = [] } = {}) {
  if (tool?.id === FILE_CONTENT_INDEX_TOOL_ID) {
    return buildIndexFileContentDeferredContext(transcript);
  }
  return null;
}

export function buildToolApprovalPreview(tool, args = {}, { deferredContext = null } = {}) {
  if (tool?.id === FILE_CONTENT_INDEX_TOOL_ID) {
    return previewIndexFileContent(deferredContext);
  }
  if (tool?.id === "account_send_email" || tool?.id === "send_email_smtp") {
    const to = Array.isArray(args.to) ? args.to.join(", ") : String(args.to ?? "");
    const subject = String(args.subject ?? "").slice(0, 80);
    const bodyPreview = String(args.body ?? "").replace(/\s+/g, " ").slice(0, 160);
    return `发送邮件 → ${to || "(未指定收件人)"}\n主题: ${subject || "(无主题)"}\n${bodyPreview}`;
  }
  if (tool?.id === "file_op" && args.operation === "delete") {
    return `删除文件: ${args.path ?? "(未指定)"}`;
  }
  if (tool?.id === "launch_app") {
    return `启动应用: ${args.app ?? "(未指定)"}`;
  }
  const argsPreview = JSON.stringify(args).slice(0, 180);
  return `${tool?.name ?? tool?.id ?? "Tool"}\n${argsPreview}`;
}
