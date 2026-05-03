#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeConfigStore } from "../src/service/core/config-store.mjs";
import { buildTaskSummaryPayload } from "../src/service/core/http-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// 1. Runtime config load/save scrubs stale DeepSeek reasoning.
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "uca-085-config-"));
  try {
    const configPath = path.join(dir, "runtime.json");
    writeFileSync(configPath, JSON.stringify({
      ai: {
        customProviders: [{
          id: "deepseek",
          name: "DeepSeek",
          kind: "openai",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-test",
          defaultModel: "deepseek-v4-flash"
        }],
        taskRouting: {
          chat: {
            providerId: "deepseek",
            model: "deepseek-v4-flash",
            mode: "default",
            reasoningEffort: "enable_thinking:true"
          }
        }
      }
    }, null, 2), "utf8");

    const store = createRuntimeConfigStore({ configPath, defaults: { security: {} } });
    const loaded = store.load();
    assert.equal(loaded.ai.customProviders[0].defaultModel, "deepseek-v4-flash");
    assert.equal(loaded.ai.taskRouting.chat.reasoningEffort, undefined);
    const persisted = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(persisted.ai.taskRouting.chat.reasoningEffort, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. /tasks/summary payload keeps long-running active tasks and source metadata.
{
  const longRunningCreated = new Date(Date.now() - 10 * 60_000).toISOString();
  const runtime = {
    store: {
      listTasks() {
        return [{
          task_id: "task_long",
          created_at: longRunningCreated,
          updated_at: longRunningCreated,
          status: "running",
          sub_status: "web_fetch",
          progress: 0.4,
          intent: "search_and_answer",
          executor: "agentic",
          user_command: "最新新闻",
          context_packet: {
            source_type: "clipboard",
            source_app: "uca.console",
            capture_mode: "manual",
            selection_metadata: { source_id: "sched_daily_news" }
          }
        }];
      }
    }
  };
  const payload = buildTaskSummaryPayload(runtime, { recentLimit: 10 });
  assert.equal(payload.active.length, 1, "long-running active task must remain active");
  assert.equal(payload.active[0].selection_metadata.source_id, "sched_daily_news");
  assert.equal(payload.active[0].schedule_source, "sched_daily_news");
}

// 3. Dock must not reintroduce the old 2-minute cutoff.
{
  const dock = read("src/desktop/renderer/dock.js");
  assert.match(dock, /\/tasks\/summary\?limit=40/, "dock should poll lightweight summary endpoint");
  assert.doesNotMatch(dock, /2\s*\*\s*60\s*\*\s*1000/, "dock must not hide active tasks after two minutes");
}

// 4. Popup card pauses auto-hide during hover, scroll and focus interaction.
{
  const popup = read("src/desktop/renderer/popup-card.js");
  for (const snippet of [
    "pointerenter",
    "pointerleave",
    "focusin",
    "focusout",
    "bodyEl.addEventListener(\"scroll\""
  ]) {
    assert.ok(popup.includes(snippet), `popup-card missing interaction keeper: ${snippet}`);
  }
}

console.log("ok verify-runtime-search-popup-autotask");
