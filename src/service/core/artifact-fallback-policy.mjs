export const FILE_GENERATION_TOOL_IDS = new Set([
  "generate_document",
  "write_file",
  "edit_file",
  "render_diagram",
  "render_svg",
  "download_file"
]);

const EXECUTORS_WITH_FILE_GENERATION_TOOLS = new Set(["tool_using", "agentic"]);

export function createFileGenerationAttemptState() {
  return {
    attempted: false,
    succeeded: false
  };
}

export function recordFileGenerationToolEvent(state, payload = {}) {
  if (!state || !FILE_GENERATION_TOOL_IDS.has(payload.tool_id ?? payload.tool ?? "")) {
    return state;
  }
  state.attempted = true;
  if (payload.success === true) state.succeeded = true;
  return state;
}

export function recordArtifactGenerated(state) {
  if (state) state.succeeded = true;
  return state;
}

export function hasFileGenerationToolCapability({
  executorId = null,
  actionToolRegistry = null
} = {}) {
  if (!EXECUTORS_WITH_FILE_GENERATION_TOOLS.has(executorId)) return false;
  if (!actionToolRegistry) return false;

  if (typeof actionToolRegistry.get === "function") {
    for (const toolId of FILE_GENERATION_TOOL_IDS) {
      if (actionToolRegistry.get(toolId)) return true;
    }
    return false;
  }

  if (typeof actionToolRegistry.list === "function") {
    return actionToolRegistry.list().some((tool) => FILE_GENERATION_TOOL_IDS.has(tool?.id));
  }

  return false;
}

/**
 * Returns a reason string if artifact recovery should be blocked, or null.
 * Centralized here so the agent-loop doesn't duplicate policy logic that
 * belongs in the shared artifact fallback layer (Codex round-1).
 */
export function artifactRecoveryBlockedReason(taskSpec = {}) {
  const goal = String(taskSpec?.goal ?? "").trim();
  const requiredToolNames = Array.isArray(taskSpec?.success_contract?.required_tool_names)
    ? taskSpec.success_contract.required_tool_names.map((name) => String(name ?? "").trim())
    : [];
  const requiredKinds = Array.isArray(taskSpec?.artifact?.required_kinds)
    ? taskSpec.artifact.required_kinds.map((kind) => String(kind ?? "").trim()).filter(Boolean)
    : [];
  if (goal === "transform_existing_file") {
    return "goal_transform_existing_file_requires_edit_file";
  }
  if (requiredToolNames.includes("edit_file")) {
    return "required_tool_edit_file_not_called";
  }
  if (requiredKinds.length > 1) {
    return "multi_artifact_required_kinds_need_explicit_tool_calls";
  }
  return null;
}

export function taskRequestsNewArtifactOutput(task = {}) {
  if (task?.task_spec?.artifact?.required === true
      || task?.task_spec?.success_contract?.artifact_created === true) {
    return true;
  }

  const text = `${task?.user_command ?? ""}`.toLowerCase();
  if (!text.trim()) return false;

  const artifactNoun = /(?:文件|文档|报告|表格|电子表格|幻灯片|演示文稿|网页|页面|图片|照片|图像|壁纸|artifact|file|document|report|spreadsheet|slides?|presentation|deck|page|image|photo|picture|wallpaper)/iu;
  const explicitExtension = /(?:\.(?:docx|pdf|pptx|xlsx|html|md|markdown|json|csv|txt|mjs|js|png|jpe?g|webp|gif|bmp|svg)\b|docx|pdf|pptx|powerpoint|\bppt\b|xlsx|excel|html|markdown|json|csv|文本文件|网页文件|图片|照片|图像|壁纸|word\s*文档)/iu;
  const explicitNewArtifactCreation = /(?:生成|创建|制作|新建|做)\s*(?:一个|一份|一张|第二个|另一个|另一份|新的|新)?\s*(?:[\w.-]+\.(?:docx|pdf|pptx|xlsx|html|md|markdown|json|csv|txt|mjs|js|png|jpe?g|webp|gif|bmp|svg)\b|docx|pdf|pptx|powerpoint|\bppt\b|xlsx|excel|html|markdown|json|csv|文件|文档|报告|表格|电子表格|幻灯片|演示文稿|网页|页面|图片|照片|图像|壁纸)|(?:create|make|build|generate)\s+(?:a|an|new|another|second)?\s*(?:[\w.-]+\.(?:docx|pdf|pptx|xlsx|html|md|markdown|json|csv|txt|mjs|js|png|jpe?g|webp|gif|bmp|svg)\b|file|document|report|spreadsheet|slides?|presentation|deck|page|image|photo|picture|wallpaper|html|json|csv|markdown|excel|pptx|powerpoint)/iu;
  const saveOrExportArtifact = /(?:保存|下载|存为|导出|写入|落盘|产出|输出|整理成|转成|转换成|save|download|export|write|produce|output|convert)\s*(?:到|为|成|as|to|into)?\s*(?:[\w.-]+\.(?:docx|pdf|pptx|xlsx|html|md|markdown|json|csv|txt|mjs|js|png|jpe?g|webp|gif|bmp|svg)\b|docx|pdf|pptx|powerpoint|\bppt\b|xlsx|excel|html|markdown|json|csv|文件|文档|报告|表格|电子表格|幻灯片|演示文稿|网页|页面|图片|照片|图像|壁纸|file|document|report|spreadsheet|slides?|presentation|deck|page|image|photo|picture|wallpaper)/iu;
  const existingArtifactReference = /(?:上一个|前一个|之前|刚才|已有|现有|原有|已生成|已创建|previous|prior|last|existing)\s*(?:生成的?|创建的?|保存的?|导出的?)?.{0,24}(?:文件|文档|报告|网页|页面|artifact|file|document|report|page)/iu;
  const inspectionVerb = /(?:读取|查看|检查|验证|确认|执行|运行|校验|分析|read|inspect|check|verify|validate|execute|run|analy[sz]e)/iu;
  if (existingArtifactReference.test(text)
      && inspectionVerb.test(text)
      && !explicitNewArtifactCreation.test(text)
      && !saveOrExportArtifact.test(text)) {
    return false;
  }

  return explicitNewArtifactCreation.test(text)
    || (saveOrExportArtifact.test(text) && (artifactNoun.test(text) || explicitExtension.test(text)));
}

export function shouldSynthesizeRequestedFallbackArtifact({
  requestedFormat = null,
  generatedArtifacts = [],
  task = null,
  fileGeneration = null,
  fileGenerationToolCapability = false
} = {}) {
  if (!requestedFormat || requestedFormat.id === "conversational") return false;
  if (Array.isArray(generatedArtifacts) && generatedArtifacts.length > 0) return false;
  if (task?.task_spec?.goal === "transform_existing_file") return false;

  const artifactRequired = task?.task_spec?.artifact?.required === true
    || task?.task_spec?.success_contract?.artifact_created === true;
  if (!artifactRequired && !taskRequestsNewArtifactOutput(task)) return false;
  const blockedByFailedGenerator = artifactRequired
    && fileGeneration?.attempted === true
    && fileGeneration?.succeeded !== true;
  const blockedByMissingGenerator = artifactRequired
    && fileGenerationToolCapability === true
    && fileGeneration?.attempted !== true;
  if (blockedByMissingGenerator) return false;
  return !blockedByFailedGenerator;
}
