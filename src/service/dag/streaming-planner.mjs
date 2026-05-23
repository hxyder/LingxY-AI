/**
 * Streaming planner — emits DAG nodes one at a time as the LLM writes them,
 * so the executor can start dispatching independent nodes while later
 * nodes are still being generated. Compresses "planner latency + Sum(steps)"
 * closer to "Max(path)" for DAGs with no-dep branches.
 *
 * Protocol: the planner is instructed to emit JSON Lines. Each line is one
 * of:
 *   - `{"summary":"...","expected_nodes":<n>}`  (optional header)
 *   - a normal node object: `{"id":"...","kind":"...","tool":"...",...}`
 *   - `{"done":true}` as an explicit terminator (optional)
 *
 * Non-streaming callers that just want the full plan can still use
 * planner.planDag(). This module is additive; failures here fall back to
 * planDag() in the entrypoint.
 */

import { createJsonLinesParser, readOpenAiStyleSseStream } from "./stream-parser.mjs";
import { buildOpenAIChatCompletionBody } from "../../shared/provider-catalog.mjs";

const STREAMING_SYSTEM_PROMPT = `You are the LingxY DAG planner in STREAMING mode. Emit JSON LINES — each line is one complete JSON object. Stream order:

1. FIRST line (optional but recommended): a summary header
   {"summary": "short user-facing description", "expected_nodes": <integer>}

2. One line per node, same schema as the non-streaming planner:
   {"id":"<unique>","kind":"mcp_tool|action_tool|workflow|skill|agent_loop",
    "tool":"...","workflowId":"...","skill":"...",
    "params":{...},"depends_on":[...],"concurrency":"parallel_safe|serial_per_session",
    "session_key":"...","timeout_ms":...,"on_failure":"retry|skip|fail|replan"}

3. Last line (optional): {"done": true}

Emit nodes in a useful order — ideally roots first so the executor can start
them while you write downstream nodes. Still keep the dependency graph
acyclic and every placeholder {{nodeId.path}} must point at a node you've
already emitted or will emit.

Output JSON Lines ONLY. No prose, no code fences, no commentary. Each line
must be exactly one complete JSON object followed by a newline.`;

function summariseTools(tools, limit = 30) {
  return tools.slice(0, limit).map((t) => `- ${t.id}: ${t.description ?? ""}`).join("\n");
}

function summariseWorkflows(catalog) {
  if (!catalog?.listWorkflows) return "";
  const summaries = catalog.listWorkflows().slice(0, 20);
  if (!summaries.length) return "";
  const lines = summaries.map((w) => {
    const full = catalog.getWorkflow?.(w.id) ?? w;
    return `- ${w.id}: ${full.description ?? w.name}`;
  });
  return `\nAvailable connector workflows:\n${lines.join("\n")}`;
}

function summariseResources(contextPacket) {
  const lines = [`Current time: ${new Date().toISOString()}`];
  const attachments = [
    ...(contextPacket?.file_paths ?? []),
    ...(contextPacket?.image_paths ?? [])
  ].filter(Boolean);
  lines.push(attachments.length
    ? `Attached files: ${JSON.stringify(attachments)}`
    : `Attached files: (none)`);
  return lines.join("\n");
}

/**
 * Stream a DAG plan from the LLM, calling onNode() for each complete JSON
 * object. Returns a summary payload when the stream ends:
 *   { ok: true, header, nodeCount, rawText }
 * or { ok: false, reason, rawText? } on failure. Failures are expected to
 * be caught by the caller, which falls back to non-streaming planDag.
 *
 * Provider abstraction: we only support OpenAI-style SSE streaming
 * (OpenAI / DeepSeek / Ollama with compatible APIs). Other providers
 * (Anthropic) return {ok:false, reason:"unsupported_provider"} so the
 * caller falls back.
 */
export async function planDagStreaming({
  userCommand,
  runtime,
  contextPacket = null,
  onNode,
  onHeader,
  // Injection for tests — lets us plug a mock stream reader.
  streamReader = null
}) {
  const { resolveProviderForTask } = await import("../executors/shared/provider-resolver.mjs");
  const provider = resolveProviderForTask("planner") ?? resolveProviderForTask("chat");
  if (!provider || provider.kind === "code_cli") {
    return { ok: false, reason: "no_provider" };
  }
  if (provider.kind !== "openai" && !streamReader) {
    // Anthropic / Kimi CLI / other — let the caller fall back to non-
    // streaming planDag which handles their formats.
    return { ok: false, reason: "unsupported_provider" };
  }

  const toolList = runtime?.actionToolRegistry?.list?.() ?? [];
  const userMessage = [
    summariseResources(contextPacket),
    summariseWorkflows(runtime?.connectorCatalog),
    `\nAvailable tools:\n${summariseTools(toolList)}`,
    `\nUser command:\n${userCommand}`
  ].filter(Boolean).join("\n");

  let nodeCount = 0;
  let header = null;
  let rawText = "";
  let parseErrors = 0;

  const parser = createJsonLinesParser({
    onLine(obj) {
      if (!obj || typeof obj !== "object") return;
      if (obj.done === true) return; // explicit terminator
      if ("summary" in obj && !("id" in obj) && !("kind" in obj)) {
        header = obj;
        onHeader?.(obj);
        return;
      }
      if (typeof obj.id === "string" && typeof obj.kind === "string") {
        nodeCount += 1;
        onNode?.(obj);
      }
    },
    onError() { parseErrors += 1; }
  });

  try {
    if (streamReader) {
      // Test / injection path.
      await streamReader({
        onDelta: (d) => { rawText += d; parser.feed(d); }
      });
    } else {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify(buildOpenAIChatCompletionBody({
          provider,
          model: provider.model,
          messages: [
            { role: "system", content: STREAMING_SYSTEM_PROMPT },
            { role: "user", content: userMessage }
          ],
          maxTokens: 2048,
          stream: true
        }))
      });
      if (!response.ok) {
        return { ok: false, reason: `http_${response.status}` };
      }
      await readOpenAiStyleSseStream(response, {
        onDelta: (d) => { rawText += d; parser.feed(d); }
      });
    }
  } catch (error) {
    parser.flush();
    return { ok: false, reason: "stream_error", error: error.message, rawText };
  }

  parser.flush();

  if (nodeCount === 0) {
    return { ok: false, reason: "no_nodes_streamed", rawText };
  }
  return { ok: true, header, nodeCount, parseErrors, rawText };
}
