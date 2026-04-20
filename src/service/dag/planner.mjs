/**
 * DAG Planner — produces a multi-step DAG plan for complex user commands.
 *
 * Called from triage when lane === "dag_planner" and the feature flag is on.
 * Takes the user command + available tools + resource context and asks one
 * LLM (via the "planner" task type — falls back to chat if no dedicated
 * provider is configured) to emit a {summary, nodes[]} JSON object.
 *
 * Phase 2: single-shot (no streaming). Phase 5 upgrades to JSON Lines
 * streaming for interleaved execution.
 */

import { NODE_KINDS, validateDagPlan } from "./schema.mjs";

function summariseTools(tools, limit = 30) {
  return tools.slice(0, limit).map((t) => `- ${t.id}: ${t.description ?? ""}`).join("\n");
}

function summariseWorkflows(catalog) {
  if (!catalog?.listWorkflows) return "";
  const summaries = catalog.listWorkflows().slice(0, 20);
  if (!summaries.length) return "";
  const lines = summaries.map((w) => {
    const full = catalog.getWorkflow?.(w.id) ?? w;
    const triggers = (full.triggerPatterns ?? []).slice(0, 3).join(" | ");
    return `- ${w.id}: ${full.description ?? w.name}${triggers ? ` (hints: ${triggers})` : ""}`;
  });
  return `\nAvailable connector workflows:\n${lines.join("\n")}`;
}

function summariseResources(contextPacket) {
  const lines = [];
  lines.push(`Current time: ${new Date().toISOString()}`);
  const attachments = [
    ...(contextPacket?.file_paths ?? []),
    ...(contextPacket?.image_paths ?? [])
  ].filter(Boolean);
  if (attachments.length) {
    lines.push(`Attached files: ${JSON.stringify(attachments)}`);
  } else {
    lines.push(`Attached files: (none)`);
  }
  const sel = typeof contextPacket?.text === "string" ? contextPacket.text.trim() : "";
  if (sel) {
    lines.push(`Selection text: ${JSON.stringify(sel.slice(0, 200))}${sel.length > 200 ? " (truncated)" : ""}`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are the LingxY DAG planner. You receive a complex user request that the triage layer decided needs multiple coordinated steps. Emit ONE JSON object with this exact schema:

{
  "summary": "short natural-language description of the plan (user-facing)",
  "nodes": [
    {
      "id": "<unique-snake_case>",
      "kind": ${JSON.stringify(NODE_KINDS)},
      "tool": "<tool_id>",            // required for mcp_tool / action_tool
      "workflowId": "<id>",           // required for workflow kind
      "skill": "<skill_id>",          // required for skill kind
      "params": { … },                // may use {{otherNodeId.path}} placeholders
      "depends_on": ["<nodeId>"],     // empty if no dependency
      "concurrency": "parallel_safe" | "serial_per_session",
      "session_key": "<template>",    // required iff concurrency=serial_per_session
      "timeout_ms": number,           // optional, sensible default if omitted
      "on_failure": "retry" | "skip" | "fail" | "replan"
    }
  ]
}

Rules:
- Only emit JSON. No prose. No code fences.
- Every node id must be unique. Every depends_on / placeholder reference must point at a node you also emit.
- Prefer "workflow" over "action_tool" when a matching connector workflow exists (listed below).
- Use "agent_loop" kind for reasoning/drafting steps — its params.userCommand is a natural-language instruction the nested agent-loop will run with the full tool belt.
- Placeholder syntax: {{nodeId}} (whole result) or {{nodeId.key.nested}} or {{nodeId.items[0].path}}. No expressions.
- MCP / action_tool nodes can run in parallel: default concurrency=parallel_safe.
- Skill nodes that share session state: concurrency=serial_per_session + a session_key template.
- Keep the plan MINIMAL. If the request could be a single step, emit a single node. Do not invent extra steps.
- NEVER embed user-data-that-you-don't-have (specific email addresses, file paths) unless the resource block gave them to you. If something is missing, emit a single agent_loop node whose userCommand asks the user for clarification.`;

async function callPlannerLLM({ userCommand, systemMessage, userMessage }) {
  const { resolveProviderForTask } = await import("../executors/shared/provider-resolver.mjs");
  // Try dedicated "planner" task type first, fall back to chat.
  const provider = resolveProviderForTask("planner") ?? resolveProviderForTask("chat");
  if (!provider || provider.kind === "code_cli") return null;

  try {
    let text = "";
    if (provider.kind === "anthropic") {
      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 2048,
          system: systemMessage,
          messages: [{ role: "user", content: userMessage }]
        })
      });
      const data = await response.json();
      text = data.content?.find((b) => b.type === "text")?.text ?? "";
    } else {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 2048,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage }
          ]
        })
      });
      const data = await response.json();
      text = data.choices?.[0]?.message?.content ?? "";
    }
    return text;
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const cleaned = String(text ?? "").replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Generate a DAG plan for the given command. Returns {plan, validation,
 * rawText, usedLLM} — the caller can decide to run the plan, fall back to
 * the single-turn agent, or surface an error. Failure modes:
 * - No provider     → returns {plan: null, reason: "no_provider"}
 * - Network / parse → returns {plan: null, reason, rawText}
 * - Invalid plan    → returns {plan: null, reason: "invalid", validation, rawText}
 * Callers must NOT block on a successful response — all paths must have
 * a fallback to single-turn, per decision #4.
 */
export async function planDag({
  userCommand,
  runtime,
  contextPacket = null,
  tools = null,
  // Injectable for tests.
  llm = callPlannerLLM
}) {
  const toolList = tools ?? runtime?.actionToolRegistry?.list?.() ?? [];
  const userMessage = [
    summariseResources(contextPacket),
    summariseWorkflows(runtime?.connectorCatalog),
    `\nAvailable tools:\n${summariseTools(toolList)}`,
    `\nUser command:\n${userCommand}`
  ].filter(Boolean).join("\n");

  const rawText = await llm({
    userCommand,
    systemMessage: SYSTEM_PROMPT,
    userMessage
  });
  if (rawText == null) {
    return { plan: null, reason: "no_provider", rawText: null };
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    return { plan: null, reason: "parse_failed", rawText };
  }

  const validation = validateDagPlan(parsed);
  if (!validation.ok) {
    return { plan: null, reason: "invalid", validation, rawText };
  }

  return { plan: parsed, validation, rawText, usedLLM: true };
}
