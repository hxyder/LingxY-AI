#!/usr/bin/env node
/**
 * try-dag.mjs — quick CLI to exercise the DAG lane against a real LLM
 * provider without touching the desktop app. Prints the timeline with
 * timestamps so you can see interleaving / parallel / replan behaviour.
 *
 * Usage:
 *   node scripts/try-dag.mjs "查一下上海 北京 成都三地天气，然后中文对比总结"
 *
 * Env vars the script honours:
 *   LINGXY_DAG_PLANNER   = "true" | "1"  — gate for DAG lane (default on)
 *   LINGXY_DAG_STREAMING = "true" | "1"  — gate for streaming mode
 *
 * Provider credentials are read from the normal config store, same as the
 * live desktop app. If no provider is configured the planner returns
 * {plan:null,reason:"no_provider"} and the script exits.
 */

import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";
import { runDagLane } from "../src/service/dag/entrypoint.mjs";

const userCommand = process.argv.slice(2).join(" ").trim();
if (!userCommand) {
  console.error("Usage: node scripts/try-dag.mjs <user command>");
  process.exit(1);
}

const { runtime } = createPersistentRuntime();
runtime.featureFlags = {
  dagPlanner: process.env.LINGXY_DAG_PLANNER !== "false",
  dagStreaming: process.env.LINGXY_DAG_STREAMING === "true"
    || process.env.LINGXY_DAG_STREAMING === "1"
};

console.log("════ runtime.featureFlags:", runtime.featureFlags);
console.log("════ command:", userCommand);
console.log();

const t0 = Date.now();
const result = await runDagLane({
  runtime,
  userCommand,
  contextPacket: null,
  executionMode: "interactive"
});

if (!result?.task) {
  console.log("[fallback] DAG lane declined:", JSON.stringify(result));
  process.exit(0);
}

const events = runtime.store.getTaskEvents(result.task.task_id) ?? [];
console.log(`════ task ${result.task.task_id} [${result.task.status}/${result.task.sub_status}]`);
console.log(`════ ${events.length} events; total ${Date.now() - t0} ms`);
console.log();

for (const event of events) {
  let payload = event.payload_json ?? event.payload;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { /* keep string */ }
  }
  const tsOffset = ((new Date(event.ts ?? event.created_at ?? Date.now()).getTime() - t0) / 1000).toFixed(3);
  const brief = typeof payload === "object" && payload
    ? JSON.stringify({
        node_id: payload.node_id,
        tool_id: payload.tool_id,
        kind: payload.kind,
        success: payload.success,
        text: typeof payload.text === "string" ? payload.text.slice(0, 140) : undefined,
        summary: typeof payload.summary === "string" ? payload.summary.slice(0, 140) : undefined,
        error: payload.error
      })
    : "";
  console.log(`  +${tsOffset}s  ${event.event_type.padEnd(28)} ${brief}`);
}

console.log();
console.log("════ DAG snapshot ══");
if (result.dagSnapshot) {
  console.log(`  status      : ${result.dagSnapshot.status}`);
  console.log(`  statuses    : ${JSON.stringify(result.dagSnapshot.statuses)}`);
  console.log(`  failedNodeId: ${result.dagSnapshot.failedNodeId ?? "-"}`);
  console.log(`  streamed    : ${result.streamed ?? false}`);
}

await runtime.emailMonitor?.stop?.();
process.exit(0);
