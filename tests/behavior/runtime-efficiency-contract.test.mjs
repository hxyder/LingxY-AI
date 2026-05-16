import test from "node:test";
import assert from "node:assert/strict";

import {
  awaitDeferredSemanticRouterPatchForPlanner
} from "../../src/service/executors/tool_using/agent-loop.mjs";
import { applyLateSemanticRouterMonotonicity } from "../../src/service/core/semantic-router-late-merge.mjs";
import {
  detectRequestedOutputFormatsForTask
} from "../../src/service/executors/kimi/output-format.mjs";
import {
  shouldSynthesizeRequestedFallbackArtifact
} from "../../src/service/core/artifact-fallback-policy.mjs";
import {
  extractPublishedDate,
  formatResultsForAssistant
} from "../../src/service/search/free-search.mjs";
import { extractEvidence } from "../../src/service/core/policy/evidence-normalizer.mjs";

test("planner does not re-wait for deferred semantic router after iteration zero", async () => {
  const events = [];
  const task = {
    context_packet: {},
    task_spec: {
      routing_degraded: true,
      goal: "qa",
      tool_policy: { web_search_fetch: { mode: "optional" } },
      success_contract: { required_policy_groups: [] }
    }
  };
  Object.defineProperty(task, "__srPatchPromise", {
    enumerable: false,
    value: new Promise((resolve) => setTimeout(() => resolve(task.task_spec), 50))
  });

  const waited = await awaitDeferredSemanticRouterPatchForPlanner({
    task,
    iteration: 1,
    runtime: { emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }) }
  });

  assert.equal(waited, false);
  assert.equal(events.length, 0);
});

test("late semantic-router patch cannot revoke external web after web evidence starts", () => {
  const task = {
    task_id: "task_runtime_efficiency_contract",
    task_spec: {
      needs_current_web_data: true,
      tool_policy: {
        policy_groups: {
          external_web_read: { mode: "required", reason: "initial current data contract" }
        },
        web_search_fetch: { mode: "required", reason: "initial current data contract" },
        fetch_url_content: { mode: "required", reason: "initial current data contract" }
      },
      success_contract: {
        required_policy_groups: ["external_web_read"]
      },
      research_quality: {
        profile: "multi_source_research",
        min_sources: 3,
        min_distinct_domains: 2
      }
    }
  };
  const runtime = {
    store: {
      getTaskEvents: () => [
        { event_type: "tool_call_proposed", payload: { tool_id: "web_search_fetch" } }
      ]
    }
  };

  const refreshed = applyLateSemanticRouterMonotonicity({
    runtime,
    task,
    refreshedSpec: {
      tool_policy: {
        policy_groups: {
          external_web_read: { mode: "forbidden", reason: "late no_external" }
        },
        web_search_fetch: { mode: "forbidden", reason: "late no_external" },
        fetch_url_content: { mode: "forbidden", reason: "late no_external" }
      },
      success_contract: { required_policy_groups: [] },
      research_quality: null
    }
  });

  assert.equal(refreshed.tool_policy.web_search_fetch.mode, "required");
  assert.equal(refreshed.tool_policy.fetch_url_content.mode, "required");
  assert.deepEqual(refreshed.success_contract.required_policy_groups, ["external_web_read"]);
  assert.equal(refreshed.research_quality.profile, "multi_source_research");
});

test("requested output detection keeps multi-file Excel plus PPT requests", () => {
  const formats = detectRequestedOutputFormatsForTask({
    user_command: "查一下美国啤酒销量，生成 Excel 和 PPT 报告"
  }).map((format) => format.id);

  assert.deepEqual(formats, ["xlsx", "pptx"]);
});

test("artifact fallback only synthesizes newly requested outputs", () => {
  const htmlFormat = detectRequestedOutputFormatsForTask({
    user_command: "继续：读取上一个生成的 HTML 文件，用 Node.js 验证内容，然后只回答标记。"
  }).find((format) => format.id === "html");

  assert.equal(Boolean(htmlFormat), true);
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: htmlFormat,
    generatedArtifacts: [],
    task: {
      user_command: "继续：读取上一个生成的 HTML 文件，用 Node.js 验证内容，然后只回答标记。",
      task_spec: { artifact: { required: false }, success_contract: {} }
    },
    fileGeneration: { attempted: false, succeeded: false },
    fileGenerationToolCapability: true
  }), false);

  const xlsxFormat = detectRequestedOutputFormatsForTask({
    user_command: "查一下美国啤酒销量，生成 Excel 和 PPT 报告"
  }).find((format) => format.id === "xlsx");
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: xlsxFormat,
    generatedArtifacts: [],
    task: {
      user_command: "查一下美国啤酒销量，生成 Excel 和 PPT 报告",
      task_spec: { artifact: { required: false }, success_contract: {} }
    },
    fileGeneration: { attempted: false, succeeded: false },
    fileGenerationToolCapability: false
  }), true);
});

test("web search evidence carries source freshness dates", () => {
  const parsed = extractPublishedDate("Sep 22, 2025 — Michelob Ultra overtook Modelo");
  assert.deepEqual(parsed, { date: "2025-09-22", precision: "day" });

  const formatted = formatResultsForAssistant([
    {
      title: "Beer sales report",
      url: "https://example.com/beer",
      snippet: "Sep 22, 2025 — sales changed",
      published_date: "2025-09-22",
      published_date_precision: "day"
    }
  ], { query: "beer", provider: "test", maxResults: 1 });
  assert.match(formatted, /日期：2025-09-22/);

  const evidence = extractEvidence([
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      metadata: {
        searched_at: "2026-05-16T12:00:00.000Z",
        results: [
          { url: "https://example.com/a", title: "A", published_date: "2025-09-22" },
          { url: "https://example.org/b", title: "B", published_date: "2025-10-30" }
        ]
      }
    }
  ]);

  assert.equal(evidence.dated_web_source_count, 2);
  assert.equal(evidence.newest_web_source_date, "2025-10-30");
  assert.equal(evidence.latest_web_search_at, "2026-05-16T12:00:00.000Z");
});
