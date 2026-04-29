#!/usr/bin/env node
/**
 * Live planner verifier for Phase A action obligations.
 *
 * This uses the real configured chat API for planning, but keeps tools safe:
 * web_search_fetch returns deterministic fixture evidence and
 * connector_workflow_run returns waiting_external_decision. No real email,
 * calendar event, or upload is executed.
 */

import assert from "node:assert/strict";

import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { createProviderAdapter } from "../src/service/executors/agentic/provider-adapter.mjs";
import {
  describeResolvedProvider,
  resolveProviderForTask
} from "../src/service/executors/shared/provider-resolver.mjs";
import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";

function fallbackDeepSeekProvider() {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  return {
    id: "openai",
    configId: "deepseek-env",
    kind: "openai",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    providerName: "DeepSeek (env)"
  };
}

function resolveLiveProvider() {
  return resolveProviderForTask("chat") ?? fallbackDeepSeekProvider();
}

function formatTool(tool = {}) {
  const required = tool.parameters?.required?.length
    ? ` required=${tool.parameters.required.join(",")}`
    : "";
  return `- ${tool.id}: ${tool.description ?? tool.name ?? ""}${required}`;
}

function formatTranscript(transcript = []) {
  if (!transcript.length) return "(empty)";
  return transcript.map((entry, index) => {
    if (entry.type === "tool_result") {
      return `${index + 1}. ${entry.tool} success=${entry.success !== false}: ${entry.observation ?? ""} metadata=${JSON.stringify(entry.metadata ?? {})}`;
    }
    if (entry.type === "contract_guidance") {
      return `${index + 1}. REQUIRED_ACTION_HANDOFF ${JSON.stringify(entry.groups ?? [])}: ${entry.instruction ?? ""}`;
    }
    if (entry.type === "synthesis_retry" || entry.type === "prose_trap_retry") {
      return `${index + 1}. ${entry.type}: ${entry.retryHint ?? entry.assistantDraft ?? entry.assistantProse ?? ""}`;
    }
    return `${index + 1}. ${entry.type ?? "event"}: ${JSON.stringify(entry).slice(0, 600)}`;
  }).join("\n");
}

function parseJsonObject(text = "") {
  const cleaned = String(text ?? "").replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function createLivePlanner(provider) {
  const adapter = createProviderAdapter(provider);
  return async function livePlanner({ task, transcript, tools, iteration }) {
    const toolIds = tools.map((tool) => tool.id);
    const system = [
      "You are testing LingxY's tool planner against a real model API.",
      "Choose exactly one next action. Use the call_tool function when a real tool call is needed; otherwise answer with final prose.",
      "The task has required_policy_groups: external_web_read and email_send.",
      "external_web_read must be satisfied before email_send, because the email body must contain the fetched evidence.",
      "email_send is not satisfied by prose, a draft, or saying you will send it. It requires connector_workflow_run with workflowId=google.gmail.draft_confirm_send.",
      "If the transcript contains REQUIRED_ACTION_HANDOFF for email_send, call connector_workflow_run immediately with a filled input object.",
      "If connector_workflow_run returns waiting_external_decision, stop; do not claim the email was sent.",
      "",
      "Available tools:",
      tools.map(formatTool).join("\n"),
      "",
      "Known connector workflow:",
      "- google.gmail.draft_confirm_send: input { to: string[], subject: string, body: string }"
    ].join("\n");
    const response = await adapter.generate({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Original request: ${task.user_command}`,
            `Iteration: ${iteration}`,
            "Transcript:",
            formatTranscript(transcript)
          ].join("\n\n")
        }
      ],
      tools: [{
        name: "call_tool",
        description: "Call one available execution tool by id.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["tool", "args"],
          properties: {
            tool: { type: "string", enum: toolIds },
            args: { type: "object", additionalProperties: true }
          }
        }
      }],
      maxTokens: 700
    });

    const nativeCall = response.tool_calls?.[0];
    if (nativeCall?.name === "call_tool") {
      return {
        type: "tool_call",
        tool: nativeCall.arguments?.tool,
        args: nativeCall.arguments?.args ?? {}
      };
    }
    if (nativeCall?.name && toolIds.includes(nativeCall.name)) {
      return {
        type: "tool_call",
        tool: nativeCall.name,
        args: nativeCall.arguments ?? {}
      };
    }

    const parsed = parseJsonObject(response.text ?? "");
    if (parsed?.tool) {
      return {
        type: "tool_call",
        tool: parsed.tool,
        args: parsed.args ?? {}
      };
    }
    if (parsed?.final) return { type: "final", text: parsed.final };
    return { type: "final", text: String(response.text ?? "").trim() || "(no live model response)" };
  };
}

const provider = resolveLiveProvider();
if (!provider) {
  console.log("skip verify-action-obligations-live: no configured chat API provider");
  process.exit(0);
}
if (!["openai", "anthropic", "ollama"].includes(provider.kind)) {
  console.log(`skip verify-action-obligations-live: provider kind ${provider.kind} is not API-backed`);
  process.exit(0);
}

const descriptor = describeResolvedProvider(provider);
console.log(`live provider: ${descriptor.provider_name ?? descriptor.provider_id} / ${descriptor.model}`);

const calls = [];
const registry = createActionToolRegistry([
  {
    id: "web_search_fetch",
    name: "Web Search Fetch",
    description: "Retrieve current external evidence for a query.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        recency: { type: "string" }
      }
    },
    policy_group: "external_web_read",
    risk_level: "low",
    requires_confirmation: false,
    async execute(args = {}) {
      calls.push({ tool: "web_search_fetch", args });
      return {
        success: true,
        observation: [
          "Live-test fixture evidence:",
          "1. US equities opened mixed today as investors watched earnings and rates.",
          "2. Technology shares were the main volatility driver.",
          "3. The email summary should mention that this is fixture evidence from the live planner test."
        ].join("\n"),
        metadata: {
          results: [
            { url: "https://example.com/market-a", title: "Market A" },
            { url: "https://example.com/market-b", title: "Market B" }
          ]
        },
        artifact_paths: []
      };
    }
  },
  {
    id: "connector_workflow_run",
    name: "Connector Workflow Run",
    description: "Run a connector workflow; use google.gmail.draft_confirm_send to prepare an email confirmation.",
    parameters: {
      type: "object",
      required: ["workflowId", "input"],
      properties: {
        workflowId: { type: "string" },
        input: { type: "object" }
      }
    },
    risk_level: "medium",
    requires_confirmation: false,
    async execute(args = {}) {
      calls.push({ tool: "connector_workflow_run", args });
      return {
        success: true,
        observation: "Waiting for user confirmation.",
        metadata: {
          connector_status: "waiting_external_decision",
          workflow_id: args.workflowId,
          approval: {
            approval_id: "approval_live_planner_test",
            proposed_target: args.workflowId,
            proposed_params: args.input ?? {}
          }
        },
        artifact_paths: []
      };
    }
  }
]);

const runtime = {
  actionToolRegistry: registry,
  toolContext: {},
  toolOutputDir: ".",
  store: { appendAuditLog() {} },
  emitTaskEvent(eventType, payload) {
    if (["contract_action_handoff", "pending_approval_created"].includes(eventType)) {
      console.log(`event ${eventType}: ${JSON.stringify(payload)}`);
    }
  }
};

const result = await runToolAgentLoop({
  runtime,
  task: {
    task_id: "task_live_action_obligation",
    user_command: "搜索今天的美股要点，并把摘要发送到 user-a@example.com",
    execution_mode: "interactive",
    task_spec: {
      connector_domain: true,
      success_contract: {
        required_policy_groups: ["external_web_read", "email_send"],
        required_tool_names: []
      },
      tool_policy: {
        web_search_fetch: { mode: "required" },
        policy_groups: { external_web_read: { mode: "required" } }
      },
      synthesis: { expected_output: "execution" },
      execution_constraints: { max_iterations: 6 }
    },
    context_packet: {
      source_app: "uca.scheduler"
    }
  },
  planner: createLivePlanner(provider)
});

console.log(`live result status: ${result.status}`);
console.log(`live calls: ${calls.map((call) => call.tool).join(" -> ")}`);

assert.equal(result.status, "waiting_external_decision");
assert.ok(calls.some((call) => call.tool === "web_search_fetch"), "live planner should satisfy external_web_read");
assert.ok(calls.some((call) => call.tool === "connector_workflow_run"), "live planner should call connector workflow after final gate/handoff");
assert.match(result.final_text ?? "", /确认|approval|confirmation|waiting/i);

console.log("ok verify-action-obligations-live");
