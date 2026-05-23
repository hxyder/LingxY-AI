export function buildHistoryString(transcript) {
  if (!transcript || transcript.length === 0) return "(no actions taken yet)";
  return transcript.map((entry, i) => {
    if (entry.type === "tool_result") {
      return `[step ${i + 1}] called ${entry.tool} → ${entry.observation ?? "(no observation)"}`;
    }
    if (entry.type === "tool_denied") {
      return `[step ${i + 1}] denied ${entry.tool}: ${entry.reason ?? ""}`;
    }
    if (entry.type === "validation_error") {
      return `[step ${i + 1}] validation error on ${entry.tool}: ${entry.error ?? ""}`;
    }
    return `[step ${i + 1}] ${entry.type}`;
  }).join("\n");
}

export function plannerToolDescriptorForAdapter() {
  return {
    name: "call_tool",
    description: "Call one available execution tool by id. Choose the tool id from Available execution tools and pass its arguments as an object.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["tool", "args"],
      properties: {
        tool: { type: "string", description: "Exact tool id to call." },
        args: { type: "object", description: "Arguments for the selected tool.", additionalProperties: true }
      }
    }
  };
}

/**
 * Render the connector catalog's workflows as a concise hint block for the
 * LLM planner. The LLM owns when to call connector_workflow_run and how to
 * sequence it with other tools; this block only tells it which workflows
 * exist, what triggers them, and what inputs they require.
 */
export function formatWorkflowsForPlanner(catalog) {
  if (!catalog || typeof catalog.listWorkflows !== "function") return "";
  const summaries = catalog.listWorkflows();
  if (!summaries.length) return "";
  const lines = ["", "Connector workflows (call via connector_workflow_run):"];
  for (const summary of summaries) {
    const full = catalog.getWorkflow?.(summary.id) ?? summary;
    const firstToolId = full.steps?.find((step) => step?.tool)?.tool;
    const firstTool = firstToolId ? catalog.getTool?.(firstToolId) : null;
    const required = firstTool?.inputSchema?.required ?? [];
    const triggers = (full.triggerPatterns ?? []).slice(0, 5).join(" | ");
    lines.push(`- ${full.id} — ${full.description ?? full.name ?? ""}`);
    if (triggers) lines.push(`    trigger hints: ${triggers}`);
    if (required.length) lines.push(`    required input: { ${required.join(", ")} }`);
  }
  lines.push("");
  lines.push("When a user asks to send mail / create calendar event / upload Drive file, prefer a workflow call with a fully-filled input. If you need data to fill the input (e.g. weather forecast, search results, current context), chain the relevant read/search tool FIRST, then call connector_workflow_run with all required fields populated. Never call connector_workflow_run with empty subject/body — the workflow validator will reject it.");
  return lines.join("\n");
}

export function summarizeToolParameters(schema = {}) {
  const properties = schema?.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
  const entries = Object.entries(properties).slice(0, 10).map(([key, descriptor = {}]) => {
    const type = descriptor.type ?? (descriptor.enum ? "enum" : "any");
    const values = Array.isArray(descriptor.enum) && descriptor.enum.length > 0
      ? `:${descriptor.enum.slice(0, 8).join("|")}`
      : "";
    return `${key}:${type}${values}`;
  });
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
}

export function formatToolDescription(tool = {}) {
  const base = String(tool.description ?? tool.name ?? "").trim();
  const metadata = [];
  metadata.push(`args=${summarizeToolParameters(tool.parameters)}`);
  if (tool.policy_group) metadata.push(`group=${tool.policy_group}`);
  if (tool.risk_level) metadata.push(`risk=${tool.risk_level}`);
  if (tool.requires_confirmation === true) metadata.push("confirmation=required");
  if (Array.isArray(tool.required_capabilities) && tool.required_capabilities.length > 0) {
    metadata.push(`capabilities=${tool.required_capabilities.join(",")}`);
  }
  return `${base} [${metadata.join("; ")}]`.trim();
}

export function formatToolForPlanner(tool = {}) {
  return `- ${tool.id}: ${formatToolDescription(tool)}`;
}
