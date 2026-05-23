const FILE_CONTENT_INDEX_TOOL_ID = "index_file_content";
const FILE_TEXT_TOOLS = new Set(["read_file_text", "read_folder_text"]);
const SKILL_INSTALL_TOOL_ID = "install_skill_from_github";
const MAX_DEFERRED_TRANSCRIPT_ENTRIES = 20;
// C18 #2c: cap the SKILL.md preview text shown in the approval card
// so a malicious 100KB SKILL.md doesn't blow up the popup. The full
// markdown is still bound by contentHash in the staging registry —
// this is purely about rendering width.
const APPROVAL_CARD_PREVIEW_MAX_CHARS = 4000;

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

// C18 #2c: when an install_skill_from_github approval is being built,
// look up the staging entry for the supplied state_token and pull
// out the SKILL.md preview the user needs to read. The deferred
// context is what buildToolApprovalPreview turns into card text.
function buildSkillInstallDeferredContext({ runtime, args = {} } = {}) {
  const token = String(args?.state_token ?? "").trim();
  if (!token) return null;
  const registry = runtime?.skillInstallState;
  if (!registry || typeof registry.inspect !== "function") return null;
  const info = registry.inspect(token);
  if (!info) return null;
  return {
    targetIdentifier: info.targetIdentifier ?? null,
    owner: info.owner ?? null,
    repo: info.repo ?? null,
    branch: info.branch ?? null,
    subPath: info.subPath ?? null,
    descriptor: info.descriptor ?? null,
    previewMarkdown: info.previewMarkdown ?? "",
    previewSizeBytes: info.previewSizeBytes ?? 0,
    contentHash: info.contentHash ?? null
  };
}

function previewSkillInstall(deferredContext = null) {
  if (!deferredContext) {
    return "Install skill from GitHub\nstate_token expired or unknown — call preview_skill_from_github first.";
  }
  const lines = [];
  lines.push("⚠️ Install third-party skill — its SKILL.md becomes part of the LLM's future prompt context.");
  lines.push("");
  lines.push(`Source: ${deferredContext.targetIdentifier ?? `${deferredContext.owner}/${deferredContext.repo}`}`);
  if (deferredContext.descriptor?.heading) {
    lines.push(`Heading: ${deferredContext.descriptor.heading}`);
  }
  if (deferredContext.descriptor?.description) {
    lines.push(`Description: ${deferredContext.descriptor.description}`);
  }
  if (deferredContext.contentHash) {
    lines.push(`Content hash: ${deferredContext.contentHash} (${deferredContext.previewSizeBytes} bytes)`);
  }
  lines.push("");
  lines.push("--- SKILL.md ---");
  const md = String(deferredContext.previewMarkdown ?? "");
  if (md.length > APPROVAL_CARD_PREVIEW_MAX_CHARS) {
    lines.push(md.slice(0, APPROVAL_CARD_PREVIEW_MAX_CHARS));
    lines.push("");
    lines.push(`[…truncated; ${md.length - APPROVAL_CARD_PREVIEW_MAX_CHARS} more chars in staging. Full bytes are bound to the approval token via contentHash.]`);
  } else {
    lines.push(md);
  }
  return lines.join("\n");
}

export function buildDeferredToolContext({ tool, transcript = [], runtime, args } = {}) {
  if (tool?.id === FILE_CONTENT_INDEX_TOOL_ID) {
    return buildIndexFileContentDeferredContext(transcript);
  }
  if (tool?.id === SKILL_INSTALL_TOOL_ID) {
    return buildSkillInstallDeferredContext({ runtime, args });
  }
  return null;
}

export function buildToolApprovalPreview(tool, args = {}, { deferredContext = null } = {}) {
  if (tool?.id === FILE_CONTENT_INDEX_TOOL_ID) {
    return previewIndexFileContent(deferredContext);
  }
  if (tool?.id === SKILL_INSTALL_TOOL_ID) {
    return previewSkillInstall(deferredContext);
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
