function normalizeSkillId(skill = {}) {
  return String(skill.id ?? skill.name ?? "").trim();
}

export function summarizeSkillForTrace(skill = {}) {
  const id = normalizeSkillId(skill);
  return {
    id,
    name: String(skill.displayName ?? skill.name ?? id).trim() || id,
    description: String(skill.description ?? "").slice(0, 220),
    entry: String(skill.entryPath ?? "").trim(),
    localOnly: skill.localOnly === true,
    thirdParty: skill.thirdParty === true
  };
}

export function renderSkillForPrompt(skill = {}) {
  const summary = summarizeSkillForTrace(skill);
  return [
    `<skill id="${summary.id}">`,
    `  name: ${summary.name}`,
    `  description: ${summary.description.slice(0, 500)}`,
    `  entry: ${summary.entry}`,
    `</skill>`
  ].join("\n");
}

function artifactKindFromTask(task = {}) {
  return String(
    task?.task_spec?.artifact?.kind
    ?? task?.task_spec?.contract?.output_contract?.kind
    ?? ""
  ).trim().toLowerCase();
}

const SKILL_KIND_KEYWORDS = Object.freeze({
  xlsx: ["spreadsheet", "excel", "xlsx", "csv", "openpyxl", "pandas"],
  docx: ["document", "docx", "word"],
  pptx: ["presentation", "powerpoint", "ppt", "pptx", "slides"],
  pdf: ["pdf"],
  html: ["html", "web"]
});

function taskSkillKinds(task = {}) {
  const kinds = new Set();
  const kind = artifactKindFromTask(task);
  if (kind) kinds.add(kind);
  const text = String(task?.user_command ?? "").toLowerCase();
  if (/\bexcel\b|xlsx|spreadsheet|csv|表格|电子表格/.test(text)) kinds.add("xlsx");
  if (/\bdocx\b|word|文档/.test(text)) kinds.add("docx");
  if (/\bpptx\b|powerpoint|ppt|演示文稿|幻灯片|slides?\b/.test(text)) kinds.add("pptx");
  if (/\bpdf\b/.test(text)) kinds.add("pdf");
  if (/\bhtml\b|网页|website|web page/.test(text)) kinds.add("html");
  return kinds;
}

function skillMatchesKinds(skill = {}, kinds = new Set()) {
  if (kinds.size === 0) return false;
  const haystack = [
    skill.id,
    skill.name,
    skill.displayName,
    skill.description,
    skill.entryPath
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  for (const kind of kinds) {
    const keywords = SKILL_KIND_KEYWORDS[kind] ?? [kind];
    if (keywords.some((keyword) => haystack.includes(keyword))) return true;
  }
  return false;
}

export function workflowHintsForTask(task = {}) {
  const kind = artifactKindFromTask(task);
  const text = String(task?.user_command ?? "").toLowerCase();
  const hints = [];
  if (kind === "xlsx" || /\bexcel\b|xlsx|spreadsheet|表格|电子表格/.test(text)) {
    hints.push("spreadsheet: structured generate_document outline, run_script pandas/openpyxl, or edit_file existing workbook");
  }
  if (kind === "docx" || /\bdocx\b|word|文档/.test(text)) {
    hints.push("document: structured sections/tables, or edit_file existing document");
  }
  if (kind === "pptx" || /\bpptx\b|powerpoint|ppt|演示文稿|幻灯片/.test(text)) {
    hints.push("presentation: multiple slides with bullets/tables instead of single prose dump");
  }
  if (kind === "pdf" || /\bpdf\b/.test(text)) {
    hints.push("pdf: structured sections/components with real rendered output");
  }
  return hints;
}

export function summarizeSkillContext(skills = [], { task = null, limit = 20 } = {}) {
  const list = Array.isArray(skills) ? skills : [];
  const relevantKinds = taskSkillKinds(task);
  const active = list
    .filter((skill) => skill?.active !== false)
    .filter((skill) => skillMatchesKinds(skill, relevantKinds))
    .slice(0, limit)
    .map(summarizeSkillForTrace)
    .filter((skill) => skill.id || skill.name);
  return {
    count: list.length,
    active_count: active.length,
    truncated: list.length > active.length,
    skills: active,
    workflow_hints: workflowHintsForTask(task)
  };
}

export function renderSkillContextForPrompt(skills = [], { task = null, limit = 20 } = {}) {
  const context = summarizeSkillContext(skills, { task, limit });
  const skillBlocks = context.skills.map(renderSkillForPrompt).join("\n\n");
  const hints = context.workflow_hints.length
    ? `\nWorkflow hints:\n${context.workflow_hints.map((hint) => `- ${hint}`).join("\n")}\n`
    : "";
  return {
    context,
    prompt: skillBlocks ? `${hints}${skillBlocks}` : hints.trim()
  };
}
