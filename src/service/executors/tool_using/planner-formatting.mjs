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
