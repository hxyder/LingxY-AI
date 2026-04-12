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
  open_url: { url: "https://example.com" },
  compose_email: { to: ["team@example.com"], subject: "Update", body: "Hello team" },
  notify: { title: "Reminder", body: "Meeting in 15 minutes" },
  copy_to_clipboard: { content: "text to copy" },
  translate_text: { text: "Hello, world", target: "zh-CN" },
  launch_app: { app: "wechat" },
  create_scheduled_task: { name: "daily-digest", trigger: { kind: "cron", expression: "0 9 * * *" }, action: { tool: "notify", args: { title: "Digest" } } }
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
  const requiredSteps = Array.isArray(spec.required_steps) && spec.required_steps.length > 0
    ? spec.required_steps.join(" -> ")
    : "(none)";
  const requiredTools = Array.isArray(spec.success_contract?.required_tool_names) && spec.success_contract.required_tool_names.length > 0
    ? spec.success_contract.required_tool_names.join(", ")
    : "(none)";
  return [
    `goal: ${spec.goal ?? "unknown"}`,
    `needs_current_web_data: ${Boolean(spec.needs_current_web_data)}`,
    `artifact_required: ${Boolean(spec.artifact?.required)}`,
    `artifact_kind: ${spec.artifact?.kind ?? "(none)"}`,
    `required_steps: ${requiredSteps}`,
    `required_tools: ${requiredTools}`,
    `must_verify_artifact: ${Boolean(spec.constraints?.must_verify_artifact)}`
  ].join("\n");
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

  const outputFormatLine = requestedFormat && requestedFormat.id && requestedFormat.id !== "conversational"
    ? `The user asked for a ${requestedFormat.id} artifact. Use the generate_document tool (kind=${requestedFormat.id}) or write_file to produce it. Do not refuse by claiming you cannot save files — you can.`
    : "If the user does not explicitly ask for a file, reply conversationally.";

  const languageLine = language && language !== "auto"
    ? `Reply to the user in ${language}.`
    : "Reply to the user in the same language they used.";

  return [
    "You are UCA's agentic assistant. You are running inside a desktop task runtime that can actually execute the tools listed below.",
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
    "1. If the task contract lists required_steps or required_tools, satisfy them before claiming completion.",
    "2. Before writing about recent, current, or time-sensitive topics, call `web_search_fetch` first and base your answer on the observation. Do not rely on training data alone.",
    "3. When the user asks for a file artifact (pptx / docx / xlsx / pdf), call `generate_document` with the appropriate `kind`. For pptx the outline shape is `{ title, subtitle?, slides: [{ heading, bullets: [string] }] }`. For ad-hoc text files, use `write_file`.",
    "4. When the user asks you to run code, use `run_script` with `language` strictly in `powershell | node | python`. Do not invent other languages.",
    "5. You may call multiple tools in sequence. Each tool returns an observation you should read before deciding the next step.",
    "6. Only say something was \"done\", \"saved\", \"launched\", or \"created\" when the corresponding tool returned `success: true` in the conversation transcript. If every attempt failed, tell the user what failed and suggest next steps — do not pretend.",
    "7. Keep your final natural-language reply concise. The real deliverables live in the generated artifacts; the reply just summarises what you did and where to find them.",
    `8. ${languageLine}`,
    "",
    "## Output format",
    "",
    outputFormatLine,
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
