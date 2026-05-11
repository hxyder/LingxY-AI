#!/usr/bin/env node
/**
 * Phase B live verifier: schedule_create obligation against a real
 * planner API.
 *
 * Asserts that when a task carries `required_policy_groups:
 * ["schedule_create"]`, the live planner picks `create_scheduled_task`
 * with a sensible trigger + action shape, instead of replying with
 * prose like "I've scheduled it for you."
 *
 * Tools are stubbed locally — no real schedule is persisted.
 */

import assert from "node:assert/strict";

import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";
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
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
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
      return `${index + 1}. ${entry.tool} success=${entry.success !== false}: ${entry.observation ?? ""}`;
    }
    if (entry.type === "contract_guidance") {
      return `${index + 1}. REQUIRED_ACTION_HANDOFF ${JSON.stringify(entry.groups ?? [])}: ${entry.instruction ?? ""}`;
    }
    return `${index + 1}. ${entry.type ?? "event"}: ${JSON.stringify(entry).slice(0, 400)}`;
  }).join("\n");
}

function parseJsonObject(text = "") {
  const cleaned = String(text ?? "").replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function createLivePlanner(provider) {
  const adapter = createProviderAdapter(provider);
  return async function livePlanner({ task, transcript, tools, iteration }) {
    const toolIds = tools.map((tool) => tool.id);
    const system = [
      "You are testing LingxY's tool planner against a real model API.",
      "Choose exactly one next action. Use the call_tool function when a real tool call is needed; otherwise answer with final prose.",
      "The task has required_policy_groups: schedule_create.",
      "schedule_create is satisfied ONLY by calling create_scheduled_task with a name + trigger + action.",
      "If the user already provided a clear time-trigger ('5 分钟后', '每天 8 点', 'tomorrow at 9am'), call create_scheduled_task — do not finalize with prose claiming it was scheduled.",
      "",
      "Trigger shapes accepted: { natural_language: '5 分钟后' } | { type: 'at', run_at: '<ISO>' } | { type: 'cron', expression: '0 9 * * *' }.",
      "Action shape: { type: 'task', target: '<short label>', params: { userCommand: '<full natural-language instruction>' } }.",
      "",
      "Available tools:",
      tools.map(formatTool).join("\n")
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
      return { type: "tool_call", tool: nativeCall.arguments?.tool, args: nativeCall.arguments?.args ?? {} };
    }
    if (nativeCall?.name && toolIds.includes(nativeCall.name)) {
      return { type: "tool_call", tool: nativeCall.name, args: nativeCall.arguments ?? {} };
    }
    const parsed = parseJsonObject(response.text ?? "");
    if (parsed?.tool) return { type: "tool_call", tool: parsed.tool, args: parsed.args ?? {} };
    if (parsed?.final) return { type: "final", text: parsed.final };
    return { type: "final", text: String(response.text ?? "").trim() || "(no live response)" };
  };
}

const provider = resolveLiveProvider();
if (!provider) {
  console.log("skip verify-schedule-create-live: no configured chat API provider");
  process.exit(0);
}
if (!["openai", "anthropic", "ollama"].includes(provider.kind)) {
  console.log(`skip verify-schedule-create-live: provider kind ${provider.kind} is not API-backed`);
  process.exit(0);
}

const descriptor = describeResolvedProvider(provider);
console.log(`live provider: ${descriptor.provider_name ?? descriptor.provider_id} / ${descriptor.model}`);

const calls = [];
const registry = createActionToolRegistry([
  {
    id: "create_scheduled_task",
    name: "Create Scheduled Task",
    description: "Schedule a task for LATER. Trigger shapes: {natural_language:'5 分钟后'} | {type:'at', run_at:'<ISO>'} | {type:'cron', expression:'0 9 * * *'}. Action: {type:'task', target:'<label>', params:{userCommand:'<full instruction>'}}.",
    parameters: {
      type: "object",
      required: ["name", "trigger", "action"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        trigger: { type: "object" },
        action: { type: "object" }
      }
    },
    policy_group: "schedule_create",
    risk_level: "high",
    requires_confirmation: false, // auto-confirm in this live harness
    async execute(args = {}) {
      calls.push({ tool: "create_scheduled_task", args });
      return {
        success: true,
        observation: `Created schedule sched_test_${Math.random().toString(36).slice(2, 8)}.`,
        metadata: {
          tool_id: "create_scheduled_task",
          schedule_id: `sched_test_${Math.random().toString(36).slice(2, 8)}`
        },
        artifact_paths: []
      };
    }
  },
  {
    id: "list_scheduled_tasks",
    name: "List Scheduled Tasks",
    description: "List currently configured schedules.",
    parameters: { type: "object", properties: {} },
    risk_level: "low",
    requires_confirmation: false,
    async execute() {
      calls.push({ tool: "list_scheduled_tasks", args: {} });
      return { success: true, observation: "No existing schedules.", metadata: {}, artifact_paths: [] };
    }
  }
]);

const events = [];
const runtime = {
  actionToolRegistry: registry,
  toolPlanner: createLivePlanner(provider),
  toolContext: {},
  pendingApprovals: { create: () => ({ approval_id: "appr_live_test" }) },
  emitTaskEvent: (eventType, payload) => events.push({ eventType, payload }),
  store: {
    appendAuditLog: () => {},
    appendEvent: () => {},
    getTask: () => null,
    updateTask: () => {}
  },
  eventBus: { publish: () => {} }
};

const task = {
  task_id: "task_live_schedule_test",
  user_command: "提醒我每天早上 8 点喝水",
  context_packet: { source_app: "uca.console", capture_mode: "manual", text: "提醒我每天早上 8 点喝水" },
  task_spec: {
    user_goal_text: "提醒我每天早上 8 点喝水",
    success_contract: {
      required_policy_groups: ["schedule_create"]
    }
  },
  task_spec_initial: {
    success_contract: { required_policy_groups: ["schedule_create"] }
  },
  execution_mode: "interactive",
  executor_history: [],
  status: "running"
};

const result = await runToolAgentLoop({
  task,
  runtime,
  maxIterations: 4
});

console.log(`live result status: ${result.status}`);
console.log(`live calls: ${calls.map((c) => c.tool).join(" -> ") || "(none)"}`);

assert.equal(
  calls.some((c) => c.tool === "create_scheduled_task"),
  true,
  `live planner must call create_scheduled_task; observed calls: ${JSON.stringify(calls.map((c) => c.tool))}`
);

const args = calls.find((c) => c.tool === "create_scheduled_task")?.args ?? {};
assert.ok(args.name, "create_scheduled_task call must include a name");
assert.ok(args.trigger, "create_scheduled_task call must include a trigger");
assert.ok(args.action, "create_scheduled_task call must include an action");
console.log(`live trigger shape: ${JSON.stringify(args.trigger).slice(0, 200)}`);
console.log(`live action shape: ${JSON.stringify(args.action).slice(0, 200)}`);

console.log("ok verify-schedule-create-live");
