import assert from "node:assert/strict";
import pricing from "../src/service/cost/pricing.json" with { type: "json" };
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { loadBuiltinTemplates } from "../src/service/templates/runtime.mjs";
import { estimateTaskCost, estimateTemplateCost } from "../src/service/cost/estimator.mjs";
import { runDagGraph } from "../src/service/dag/scheduler.mjs";
import { buildDagViewModel } from "../src/service/dag/visualizer.mjs";
import { buildTemplateEditorViewModel } from "../src/desktop/console/template_editor/view-model.mjs";
import { buildDagConsoleViewModel } from "../src/desktop/console/dag_view/view-model.mjs";
import { buildBudgetDashboardViewModel } from "../src/desktop/console/budget_dashboard/view-model.mjs";
import { buildHistorySearchViewModel } from "../src/desktop/console/history_search/view-model.mjs";

const service = createServiceBootstrap();
const templates = await loadBuiltinTemplates();

assert.equal(templates.length, 5);
assert.equal(service.runtime.platform.templateRegistry.list().length, 5);

const template = service.runtime.platform.templateRegistry.get("legal.contract.review");
assert.equal(template.schema_version, "1.0");

const estimated = estimateTemplateCost(template, "kimi.k2");
assert.equal(estimated.executorId, "kimi.k2");
assert.equal(estimated.usd > 0, true);

const cheapTask = estimateTaskCost({
  executorId: "openai.gpt-5.4-mini",
  tokensIn: 10000,
  tokensOut: 2000
});
assert.equal(cheapTask.usd > 0, true);

const budgetPreview = service.runtime.platform.budgetManager.preview({
  usd: pricing.defaults.monthly_usd_limit * 0.81,
  tokensIn: 1000,
  tokensOut: 1000
});
assert.equal(budgetPreview.warn, true);
assert.equal(budgetPreview.hardStop, false);

const hardStopPreview = service.runtime.platform.budgetManager.preview({
  usd: pricing.defaults.monthly_usd_limit,
  tokensIn: 1000,
  tokensOut: 1000
});
assert.equal(hardStopPreview.hardStop, true);

const graph = {
  nodes: [
    { id: "extract", target: "pdf_ocr" },
    { id: "analyze", target: "kimi" },
    { id: "report", target: "fast" }
  ],
  edges: [
    { from: "extract", to: "analyze" },
    { from: "analyze", to: "report" }
  ]
};

const events = [];
const dagResult = await runDagGraph({
  graph,
  async executeNode(node, context) {
    return {
      nodeId: node.id,
      previousCount: Object.keys(context.results).length
    };
  },
  onNodeEvent(event) {
    events.push(event);
  }
});
assert.equal(dagResult.status, "success");
assert.equal(dagResult.statuses.report, "success");
assert.equal(events.filter((event) => event.status === "success").length, 3);

const failedResult = await runDagGraph({
  graph,
  async executeNode(node) {
    if (node.id === "analyze") {
      throw new Error("planner_failed");
    }
    return { nodeId: node.id };
  }
});
assert.equal(failedResult.status, "failed");
assert.equal(failedResult.statuses.report, "blocked");

const graphVm = buildDagViewModel(graph, dagResult);
assert.equal(graphVm.nodes.length, 3);

service.runtime.platform.embeddingStore.add({
  id: "task-001",
  text: "合同风险审查与关键条款总结",
  metadata: {
    summary: "合同风险审查",
    created_at: "2026-04-08T10:00:00Z"
  }
});
service.runtime.platform.embeddingStore.add({
  id: "task-002",
  text: "浏览器文章总结与翻译",
  metadata: {
    summary: "网页总结",
    created_at: "2026-04-08T11:00:00Z"
  }
});
const matches = service.runtime.platform.embeddingStore.search("合同条款风险总结", 1);
assert.equal(matches[0].id, "task-001");

const templateVm = buildTemplateEditorViewModel({
  templates,
  selectedTemplateId: template.id,
  validation: { ok: true, errors: [] }
});
assert.equal(templateVm.templateCount, 5);

const dagConsoleVm = buildDagConsoleViewModel(graph, dagResult);
assert.equal(dagConsoleVm.nodes.find((node) => node.id === "report")?.status, "success");

const budgetVm = buildBudgetDashboardViewModel({
  budgetState: service.runtime.platform.budgetManager.getState(),
  pricingEntries: Object.entries(pricing.executors)
});
assert.equal(budgetVm.monthlyLimitUsd, 50);

const historyVm = buildHistorySearchViewModel("合同", matches);
assert.equal(historyVm.resultCount, 1);

assert.equal(service.runtime.executorRegistry.pick({ privacyLevel: "local_only" }).id, "fast");
assert.equal(service.runtime.platform.aiProviders.list().length, 4);
assert.equal(service.runtime.platform.codeCliAdapters.list().length, 2);
assert.equal(service.runtime.platform.mcpServers.list().length, 2);
assert.equal(service.runtime.platform.skillRegistries.list().length, 1);

console.log("Platform foundation verification passed.");
