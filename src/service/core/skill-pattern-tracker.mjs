/**
 * UCA-075: Auto-classify repeated tool sequences as reusable skills.
 *
 * When the same ordered tool sequence succeeds 3+ times, this module
 * proposes saving a SKILL.md file to the LingxY skills directory so the
 * agentic executor can reference it in future tasks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROPOSAL_THRESHOLD = 3;   // occurrences before proposing
const MAX_TOOLS_IN_PATTERN = 8; // avoid saving huge sequences

// Tools too generic to form a meaningful skill on their own. Also excludes
// connector workflow internals — a connector workflow is itself a composed
// skill, so tracking its steps as a separate pattern produces garbage like
// "create_draft_preview → connector_workflow_run".
const SKIP_TOOLS = new Set([
  "notify", "copy_to_clipboard", "verify_file_exists", "register_artifact",
  "resolve_output_path",
  // connector workflow + catalog internals
  "connector_workflow_run", "connector_catalog_search", "connector_catalog_get",
  "connector_plugin_manage"
]);

const SKIP_TOOL_PREFIXES = ["google.", "microsoft.", "mcp."];

// ── Persistence ────────────────────────────────────────────────────────────────

function loadStore(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { patterns: {} };
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { patterns: {} };
  }
}

function saveStore(filePath, store) {
  if (!filePath) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n", "utf8");
}

// ── Pattern extraction ─────────────────────────────────────────────────────────

function shouldSkipTool(toolId) {
  if (SKIP_TOOLS.has(toolId)) return true;
  return SKIP_TOOL_PREFIXES.some((prefix) => String(toolId).startsWith(prefix));
}

export function extractToolSequence(taskEvents = []) {
  return taskEvents
    .filter(
      (e) =>
        e.event_type === "tool_call_completed" &&
        e.payload?.success !== false &&
        e.payload?.tool_id
    )
    .map((e) => e.payload.tool_id)
    .filter((t) => !shouldSkipTool(t))
    .slice(0, MAX_TOOLS_IN_PATTERN);
}

// ── Skill ID / name generation ──────────────────────────────────────────────────

function toSkillId(tools) {
  return tools
    .slice(0, 3)
    .map((t) => t.replace(/_/g, "-"))
    .join("-");
}

function toSkillName(tools) {
  const labels = {
    web_search_fetch: "网络搜索",
    open_url: "打开网页",
    launch_app: "启动应用",
    open_file: "打开文件",
    write_file: "写文件",
    compose_email: "撰写邮件",
    send_email_smtp: "发送邮件",
    generate_document: "生成文档",
    translate_text: "翻译",
    take_screenshot: "截图",
    run_script: "执行脚本",
    find_recent_files: "查找文件"
  };
  return tools
    .slice(0, 3)
    .map((t) => labels[t] ?? t)
    .join(" → ");
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Record a successful tool sequence. Returns a skill proposal if threshold
 * is reached for the first time, or null otherwise.
 */
export function recordToolSequence(filePath, { taskId, command, toolSequence }) {
  if (!toolSequence || toolSequence.length < 2) return null;
  // Require 2+ distinct tools: "web_search_fetch → web_search_fetch" or
  // similar repeats are not meaningful skills.
  const distinct = new Set(toolSequence);
  if (distinct.size < 2) return null;

  const store = loadStore(filePath);
  const key = toolSequence.join(",");
  const entry = store.patterns[key] ?? {
    key,
    tools: toolSequence,
    count: 0,
    examples: [],
    skillId: null,
    proposedAt: null
  };

  entry.count += 1;
  entry.examples = [
    ...entry.examples.slice(-9), // keep last 10
    { taskId, command: String(command ?? "").slice(0, 120), ts: new Date().toISOString() }
  ];

  store.patterns[key] = entry;
  saveStore(filePath, store);

  // Propose once: exactly when count reaches threshold AND no skill saved yet
  if (entry.count === PROPOSAL_THRESHOLD && !entry.skillId) {
    entry.proposedAt = new Date().toISOString();
    saveStore(filePath, store);
    return {
      patternKey: key,
      tools: toolSequence,
      count: entry.count,
      examples: entry.examples,
      suggestedId: toSkillId(toolSequence),
      suggestedName: toSkillName(toolSequence)
    };
  }
  return null;
}

/**
 * Save an auto-generated SKILL.md to the skills directory and mark the
 * pattern as saved in the tracker store.
 */
export function saveAutoSkill(filePath, skillsDir, { patternKey, tools, examples, suggestedId, suggestedName }) {
  const skillId = suggestedId ?? toSkillId(tools);
  const skillDir = path.join(skillsDir, skillId);
  mkdirSync(skillDir, { recursive: true });

  const exampleCommands = examples
    .slice(-3)
    .map((ex) => `- ${ex.command}`)
    .join("\n");

  const toolSteps = tools.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const skillMd = `# ${suggestedName ?? skillId}
description: 自动从重复操作归纳的技能 — ${tools.join(" → ")}

## 使用场景
用户在类似任务中重复执行以下操作流程（已执行 ${examples.length}+ 次）：
${exampleCommands}

## 操作步骤
${toolSteps}
`;

  const skillPath = path.join(skillDir, "SKILL.md");
  writeFileSync(skillPath, skillMd, "utf8");

  // Mark as saved in tracker store
  if (filePath) {
    const store = loadStore(filePath);
    if (store.patterns[patternKey]) {
      store.patterns[patternKey].skillId = skillId;
      store.patterns[patternKey].skillPath = skillPath;
      saveStore(filePath, store);
    }
  }

  return { skillId, skillPath };
}
