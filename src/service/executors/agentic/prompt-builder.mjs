/**
 * Agentic prompt builder — renders the system prompt for the provider-
 * agnostic agentic planner, pulling the tool catalogue *dynamically* from
 * the action tool registry.
 *
 * The key design requirement from UCA-049 §D is that the tool catalogue is
 * never a hardcoded string: whenever a new tool is added (`write_file` /
 * `run_script` / `generate_document` / future tools) the planner must see it
 * without a separate prompt edit. The builder reads the registry at call
 * time and formats each tool entry plus a small example set.
 */

const DEFAULT_EXAMPLES = {
  web_search_fetch: { query: "latest AI trends 2026", recency: "month" },
  write_file: { path: "notes/plan.md", content: "# Plan\n- step 1\n- step 2" },
  run_script: { language: "node", script: "console.log(2 + 2);", timeout: 5 },
  generate_document: {
    kind: "pptx",
    outline: {
      title: "Quarterly Review",
      slides: [
        { heading: "Revenue", bullets: ["+12% YoY", "Strong Q4"] },
        { heading: "Risks", bullets: ["Churn steady"] }
      ]
    }
  },
  edit_file: {
    path: "C:\\Users\\you\\Documents\\Quarterly Review.pptx",
    outline: {
      title: "Quarterly Review",
      slides: [
        { heading: "Revenue", bullets: ["+12% YoY", "Strong Q4", "Add source link in footer"] }
      ]
    }
  },
  open_url: { url: "https://example.com" },
  compose_email: { to: ["team@example.com"], subject: "Update", body: "Hello team" },
  notify: { title: "Reminder", body: "Meeting in 15 minutes" },
  copy_to_clipboard: { content: "text to copy" },
  translate_text: { text: "Hello, world", target: "zh-CN" },
  launch_app: { app: "wechat" },
  create_scheduled_task: { name: "daily-digest", trigger: { type: "cron", expression: "0 9 * * *" }, action: { type: "action_tool", target: "notify", params: { title: "Digest" } } }
};

function prettifyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function toolParametersSummary(tool) {
  const params = tool.parameters ?? {};
  const props = params.properties ?? {};
  const entries = Object.entries(props);
  if (entries.length === 0) return "(no parameters)";
  return entries.map(([name, spec]) => {
    const type = spec?.type ? `: ${spec.type}` : "";
    return `${name}${type}`;
  }).join(", ");
}

function renderToolBlock(tool) {
  const example = DEFAULT_EXAMPLES[tool.id] ?? {};
  return [
    `<tool id="${tool.id}">`,
    `  name: ${tool.name}`,
    `  description: ${tool.description ?? ""}`,
    `  risk: ${tool.risk_level ?? "unknown"}`,
    `  parameters: { ${toolParametersSummary(tool)} }`,
    `  example: ${prettifyJson(example)}`,
    `</tool>`
  ].join("\n");
}

function renderSkillBlock(skill) {
  return [
    `<skill id="${skill.id}">`,
    `  name: ${skill.displayName ?? skill.id}`,
    `  description: ${(skill.description ?? "").slice(0, 500)}`,
    `  entry: ${skill.entryPath ?? ""}`,
    `</skill>`
  ].join("\n");
}

function renderTaskContract(task) {
  const spec = task?.task_spec;
  if (!spec) return "(none)";
  const requiredTools = Array.isArray(spec.success_contract?.required_tool_names) && spec.success_contract.required_tool_names.length > 0
    ? spec.success_contract.required_tool_names.join(", ")
    : "(none)";

  // UCA-077 P1-07: render the resolved tool policy verbatim so the LLM sees
  // the decision (required / optional / forbidden) and the reason. The old
  // version exposed `required_steps` (a sequence of internal step names that
  // the LLM had no real way to act on) and `needs_current_web_data` (a flag
  // stripped of context). Both are gone — policy carries the same info with
  // evidence attached.
  const policyLines = [];
  const webPolicy = spec.tool_policy?.web_search_fetch;
  if (webPolicy) {
    policyLines.push(`web_search_fetch: ${webPolicy.mode}`);
    if (webPolicy.reason) policyLines.push(`  reason: ${webPolicy.reason}`);
  }

  return [
    `goal: ${spec.goal ?? "unknown"}`,
    `artifact_required: ${Boolean(spec.artifact?.required)}`,
    `artifact_kind: ${spec.artifact?.kind ?? "(none)"}`,
    `required_tools: ${requiredTools}`,
    `must_verify_artifact: ${Boolean(spec.constraints?.must_verify_artifact)}`,
    "tool_policy:",
    ...(policyLines.length ? policyLines.map((line) => `  ${line}`) : ["  (none)"])
  ].join("\n");
}

export function isAudioNoteSingleMarkdownTask(task = null) {
  const sourceType = task?.context_packet?.source_type ?? "";
  const sourceApp = task?.context_packet?.source_app ?? "";
  return sourceType === "audio_note" || sourceApp === "uca.note";
}

/**
 * Render a system prompt that tells the LLM:
 *   1. Its role and constraints
 *   2. The entire current tool catalogue (dynamic)
 *   3. A small set of behavioural rules that enforce the UCA-049 §B
 *      "truthfulness" constraint (the LLM must not claim completion unless
 *      a tool returned success:true).
 *
 * @param {object} opts
 * @param {Array}  opts.tools           — tool definitions from the registry
 * @param {object} opts.task            — task record (for output format hints)
 * @param {object} opts.requestedFormat — result of detectRequestedOutputFormat
 * @param {string} opts.language        — ISO-ish language hint for final reply
 * @returns {string} system prompt
 */
export function buildAgenticSystemPrompt({
  tools = [],
  skills = [],
  task = null,
  requestedFormat = null,
  language = "auto"
} = {}) {
  const toolBlocks = tools.map((tool) => renderToolBlock(tool)).join("\n\n");
  const skillBlocks = skills.slice(0, 20).map((skill) => renderSkillBlock(skill)).join("\n\n");
  const isAudioNoteTask = isAudioNoteSingleMarkdownTask(task);

  const outputFormatLine = isAudioNoteTask
    ? "This is an audio note task. Create exactly one Markdown artifact named \"录音转录结构化笔记.md\" using `write_file`. Do not call `generate_document`; do not create docx, pdf, html, or a second file."
    : requestedFormat?.id === "markdown"
      ? "The user asked for a Markdown artifact. Use `write_file` to create exactly one .md file. Do not call `generate_document` for Markdown."
      : requestedFormat && requestedFormat.id && requestedFormat.id !== "conversational"
        ? `The user asked for a ${requestedFormat.id} artifact. Use generate_document (kind=${requestedFormat.id}) to create a new file, or edit_file to update an existing artifact in place. Pass outline as a native JSON object, not a stringified JSON blob. Do not refuse by claiming you cannot save files — you can.`
        : "If the user does not explicitly ask for a file, reply conversationally.";

  const languageLine = language && language !== "auto"
    ? `Reply to the user in ${language}.`
    : "Reply to the user in the same language they used.";

  // UCA-098: When the task is the firing of an already-scheduled run, the
  // scheduler feeds the original natural-language command back through the
  // executor. Without this banner the LLM re-interprets e.g. "提醒我喝水"
  // as a new scheduling request and calls create_scheduled_task again,
  // and when the tool layer refuses it (UCA-096 guard), flounders and
  // emits a confused "sorry I can't create a timer in this environment"
  // reply. Same signal as tool_using/agent-loop.mjs uses.
  const scheduledFireBanner = task?.context_packet?.source_app === "uca.scheduler"
    ? "\n\n## Scheduled-fire context\n\nThis request is the actual firing of an already-scheduled task — the delay has ALREADY elapsed. Execute the action directly. Do NOT call `create_scheduled_task`. For a reminder, call `notify` with a concise title and body. For an email, call the send workflow. The scheduling was done earlier; your job here is to perform the action."
    : "";

  // Inject the wall-clock date/time so the model doesn't fall back on
  // its training-cutoff year (2025-ish for most current models, which
  // shows up as "2025年XX月" in answers no matter what the user is
  // actually asking about). Mirrors the tool_using/agent-loop.mjs
  // injection — the missing sibling was the whole bug.
  const nowLocal = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const timeBanner = `Current local date and time: ${nowLocal.toLocaleString("sv-SE", { hour12: false })} (${tz}). Treat "今天/明天/昨天/this week/today/tomorrow/yesterday" as relative to this moment. Do NOT emit years or dates from training memory.`;

  return [
    "You are UCA's agentic assistant. You are running inside a desktop task runtime that can actually execute the tools listed below.",
    "",
    timeBanner,
    "",
    "## Available tools",
    "",
    toolBlocks,
    "",
    "## Available skills",
    "",
    skillBlocks || "(none)",
    "",
    "## Task contract",
    "",
    renderTaskContract(task),
    "",
    "## Rules",
    "",
    // UCA-077 P1-07: Rule 1 used to start with "satisfy required_steps" —
    // those steps no longer exist in the prompt. The contract above already
    // states required_tools and tool_policy; the LLM should consult that.
    "1. Honour the task contract: call every tool listed in `required_tools`, and obey the `tool_policy` block. If a tool is marked `required`, you must call it before claiming completion. If marked `forbidden`, do not call it. `optional` means you may use the tool when you judge it useful but it is not enforced.",
    // UCA-077 P1-07: the old Rule 2 ("Before writing about recent topics, call web_search_fetch first")
    // was the system policy leaking into the prompt. Whether to search is
    // now decided by tool-policy-resolver and surfaced via tool_policy
    // above. The fallback URLs are kept as a separate hint because they
    // are still useful when web_search_fetch IS being called and fails.
    "2. If `tool_policy.web_search_fetch` is `required` and `web_search_fetch` returns no results or fails, use `fetch_url_content` on a specific authoritative URL instead — for example: weather.gov or wttr.in for weather, en.wikipedia.org for facts, finance.yahoo.com for stock prices. Do not fall back to training data for time-sensitive information.",
    "3. When the user asks for a file artifact (pptx / docx / xlsx / pdf), call `generate_document` with the appropriate `kind`. If they ask to revise an already-generated file, locate the existing artifact path and call `edit_file` with the SAME absolute path so the file is updated in place instead of creating a new sibling. Outline shapes by kind: pptx → `{ title, subtitle?, slides: [{ heading, bullets: [string] }] }`; docx/pdf → `{ title, sections: [{ heading, body }] }` (each section's body is a paragraph of prose, may include bullet lines starting with \"- \"); xlsx → `{ rows: [[col1, col2, ...]] }`. For ad-hoc text files, use `write_file`.",
    "4. When the user asks you to run code, use `run_script` with `language` strictly in `powershell | node | python`. Do not invent other languages.",
    "5. You may call multiple tools in sequence. Each tool returns an observation you should read before deciding the next step.",
    "6. Only say something was \"done\", \"saved\", \"launched\", or \"created\" when the corresponding tool returned `success: true` in the conversation transcript. If every attempt failed, tell the user what failed and suggest next steps — do not pretend.",
    "7. Keep your final natural-language reply concise. The real deliverables live in the generated artifacts; the reply just summarises what you did and where to find them.",
    // UCA-182 Phase 21: memory tools. We no longer pre-inject guess-at
    // context; the model asks for what it needs.
    "8. Memory: when the user refers to earlier work with a pronoun (\"上个问题\" / \"刚才\" / \"之前那份\" / \"last one\" / \"that report\") or asks you to continue / revise / elaborate on something you or they did before, you MUST call `list_recent_tasks` first (or `recall_memory` with a topic query if the reference is thematic rather than temporal). Then call `get_task_detail` on the matching task_id to load its user_command + final answer + artifact paths. Only after you have concrete details should you act — never guess from the pronoun alone, and never claim you cannot remember prior work while these tools exist.",
    `9. ${languageLine}`,
    "",
    "## Output format",
    "",
    outputFormatLine,
    scheduledFireBanner,
    task?.user_command ? `\nUser's original request: ${task.user_command}` : ""
  ].join("\n");
}

/**
 * Helper for tests: extract the tool ids that the prompt explicitly names,
 * so we can assert the dynamic registry rendering is wired up.
 */
export function listToolIdsInPrompt(prompt) {
  const matches = [...String(prompt).matchAll(/<tool id="([^"]+)">/g)];
  return matches.map((m) => m[1]);
}
