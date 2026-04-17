import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { createTaskRecord } from "../src/service/core/task-runtime.mjs";
import { decomposeUserCommand } from "../src/service/core/router/decomposer.mjs";
import {
  resolveRoutedModel,
  describeResolvedProvider,
  resolveCodeCliRuntimeForTask,
  resolveActiveProviderForTask
} from "../src/service/executors/shared/provider-resolver.mjs";
import { createProviderAdapter } from "../src/service/executors/agentic/provider-adapter.mjs";

const service = createServiceBootstrap();

if (service.store.engine !== "sqlite") {
  throw new Error("Expected sqlite store manifest.");
}

if (!service.runtime.executors.find((executor) => executor.id === "fast")) {
  throw new Error("Fast executor scaffold is missing.");
}

if (!service.runtime.executors.find((executor) => executor.id === "kimi")) {
  throw new Error("Kimi executor scaffold is missing.");
}

if (!service.runtime.executors.find((executor) => executor.id === "tool_using")) {
  throw new Error("Tool-using executor scaffold is missing.");
}

if (!service.runtime.executors.find((executor) => executor.id === "multi_modal")) {
  throw new Error("Multi-modal executor scaffold is missing.");
}

if (!service.runtime.securityBroker) {
  throw new Error("Security broker scaffold is missing.");
}

if (!service.runtime.scheduler) {
  throw new Error("Scheduler scaffold is missing.");
}

if (!service.runtime.officeHttps) {
  throw new Error("Office HTTPS scaffold is missing.");
}

if (service.runtime.persistSecurityConfig({ offline_mode: true }).offline_mode !== true) {
  throw new Error("Security config persistence hook is missing.");
}

if (!service.runtime.executorRegistry) {
  throw new Error("Executor registry scaffold is missing.");
}

if (!service.runtime.platform) {
  throw new Error("Platform foundation scaffold is missing.");
}

const route = service.routeIntent("请帮我总结剪贴板内容");
if (route.intent !== "summarize") {
  throw new Error("Intent router scaffold did not resolve summarize.");
}

const latestTaskRoute = service.routeIntent("搜索最新 AI 新闻并生成一份 ppt");
const latestTask = createTaskRecord({
  route: latestTaskRoute,
  contextPacket: {
    schema_version: "1.0",
    source_type: "manual",
    source_app: "verify-service-core",
    capture_mode: "test",
    text: ""
  },
  userCommand: "搜索最新 AI 新闻并生成一份 ppt"
});
if (!latestTask.task_spec || latestTask.task_spec_valid !== true) {
  throw new Error(`TaskSpec was not attached to created task: ${(latestTask.task_spec_errors ?? []).join("; ")}`);
}
if (!latestTask.task_spec.needs_current_web_data || !latestTask.task_spec.success_contract.required_tool_names.includes("web_search_fetch")) {
  throw new Error("TaskSpec must require web_search_fetch for latest/current tasks.");
}
if (!latestTask.task_spec.artifact.required || latestTask.task_spec.artifact.kind !== "pptx" || !latestTask.task_spec.required_steps.includes("verify_file_exists")) {
  throw new Error("TaskSpec must require artifact verification for generated PPT tasks.");
}

const iranDocCommand = "结合这周末伊朗局势的情况以及变化，给我生成一份下周美股投资策略的方案。一份word文档吧。";
const iranDocTask = createTaskRecord({
  route: service.routeIntent(iranDocCommand),
  contextPacket: {
    schema_version: "1.0",
    source_type: "manual",
    source_app: "verify-service-core",
    capture_mode: "test",
    text: ""
  },
  userCommand: iranDocCommand
});
if (iranDocTask.task_spec.goal !== "generate_document"
    || iranDocTask.task_spec.artifact.kind !== "docx"
    || iranDocTask.task_spec.constraints.can_split !== false
    || iranDocTask.task_spec.needs_current_web_data !== true) {
  throw new Error("TaskSpec must keep current-events Word document requests as one agentic artifact task.");
}
const iranDocDecomposition = await decomposeUserCommand({
  userCommand: iranDocCommand,
  runtime: {
    ...service.runtime,
    async intentDecomposer() {
      return {
        subtasks: [
          { command: "搜索伊朗局势", suggested_executor: "web_search_fetch", suggested_formats: [], dependency_idx: null },
          { command: "生成美股投资策略 word 文档", suggested_executor: "generate_document", suggested_formats: ["docx"], dependency_idx: 0 }
        ]
      };
    }
  }
});
if (iranDocDecomposition.subtasks.length !== 1 || iranDocDecomposition.usedLLM !== false) {
  throw new Error("Decomposer must not split a single artifact-producing Word document request.");
}

// UCA-049: "分析 / generate report" now gets upgraded to the agentic
// executor so the planner can coordinate search + generate_document. The
// underlying matched rule is still `kimi` — verify via intent_tags.
const kimiRoute = service.routeIntent("分析这个文件并生成报告");
if (kimiRoute.executor !== "agentic") {
  throw new Error(`Intent router should upgrade analyze+report flow to agentic; got ${kimiRoute.executor}.`);
}
if (!kimiRoute.intent_tags?.includes("analyze") || !kimiRoute.intent_tags?.includes("generate_report")) {
  throw new Error("Intent router did not tag analyze+generate_report correctly.");
}

const imageRoute = service.routeIntent("请分析这张图片");
if (imageRoute.executor !== "multi_modal") {
  throw new Error("Intent router must keep image analysis on multi_modal (not agentic).");
}

// pptx request → suggested_formats includes pptx and executor is agentic.
const pptxRoute = service.routeIntent("分析 AI 发展趋势，并生成一份 ppt");
if (pptxRoute.executor !== "agentic") {
  throw new Error("Intent router must upgrade pptx requests to the agentic executor.");
}
if (!pptxRoute.suggested_formats?.includes("pptx")) {
  throw new Error("Intent router must surface pptx in suggested_formats.");
}

// translate request → stays on translate executor (single-shot).
const translateRoute = service.routeIntent("翻译这段话");
if (translateRoute.executor !== "translate") {
  throw new Error("Intent router must not upgrade translate requests to agentic.");
}

const scheduleRoute = service.routeIntent("明天上午9点提醒我开会");
if (scheduleRoute.executor !== "agentic" || !scheduleRoute.intent_tags?.includes("schedule")) {
  throw new Error("Natural-language schedule requests should route through the agentic AI layer.");
}

const decomposition = await decomposeUserCommand({
  userCommand: "总结一下近一年AI发展的新趋势，并生成一个PPT，加一些图表",
  runtime: {
    ...service.runtime,
    async intentDecomposer() {
      return {
        subtasks: [
          {
            command: "总结近一年 AI 发展的新趋势，并生成包含图表的一份 PPT",
            suggested_executor: "agentic",
            suggested_formats: ["pptx"],
            dependency_idx: null
          }
        ]
      };
    }
  }
});
if (decomposition.usedLLM !== false || decomposition.subtasks.length !== 1) {
  throw new Error("Artifact-producing requests should bypass AI decomposition and stay as one task.");
}
if (decomposition.subtasks[0].suggested_executor !== "agentic" || !decomposition.subtasks[0].suggested_formats.includes("pptx")) {
  throw new Error("Decomposer fallback did not preserve agentic pptx artifact metadata.");
}

const ruleOnlyDecomposition = await decomposeUserCommand({
  userCommand: "翻译这段话，然后总结那份报告",
  mode: "rules_only"
});
if (ruleOnlyDecomposition.subtasks.length < 2) {
  throw new Error("Rules-only decomposer mode should still split explicit test conjunctions.");
}

if (service.endpoints.postTask !== "/task") {
  throw new Error("Task endpoint manifest is invalid.");
}

if (service.endpoints.postOfficeTask !== "/office/task") {
  throw new Error("Office task endpoint manifest is invalid.");
}

if (service.endpoints.browserNativeHost !== "native://com.uca.host") {
  throw new Error("Browser native host manifest is invalid.");
}

if (service.endpoints.metrics !== "/metrics") {
  throw new Error("Metrics endpoint manifest is invalid.");
}

if (service.endpoints.getTemplates !== "/templates") {
  throw new Error("Templates endpoint manifest is invalid.");
}

if (service.endpoints.postDagPreview !== "/dag/preview") {
  throw new Error("DAG preview endpoint manifest is invalid.");
}

if (service.endpoints.getBudget !== "/budget") {
  throw new Error("Budget endpoint manifest is invalid.");
}

if (service.endpoints.postHistorySearch !== "/history/search") {
  throw new Error("History search endpoint manifest is invalid.");
}

if (service.endpoints.getProjectStore !== "/projects/store" || service.endpoints.postProjectStore !== "/projects/store") {
  throw new Error("Project store endpoint manifest is invalid.");
}

if (service.endpoints.health !== "/health") {
  throw new Error("Health endpoint manifest is invalid.");
}

if (service.endpoints.listTasks !== "/tasks") {
  throw new Error("Tasks endpoint manifest is invalid.");
}

if (service.endpoints.getTask !== "/task/:id") {
  throw new Error("Task detail endpoint manifest is invalid.");
}

if (service.endpoints.cancelTask !== "/task/:id/cancel") {
  throw new Error("Cancel endpoint manifest is invalid.");
}

if (service.endpoints.getPendingApprovals !== "/approvals") {
  throw new Error("Pending approvals endpoint manifest is invalid.");
}

if (service.endpoints.approvePendingApproval !== "/approvals/:id/approve") {
  throw new Error("Approve pending approval endpoint manifest is invalid.");
}

if (service.endpoints.rejectPendingApproval !== "/approvals/:id/reject") {
  throw new Error("Reject pending approval endpoint manifest is invalid.");
}

if (service.endpoints.getAuditLogs !== "/audit-log") {
  throw new Error("Audit log endpoint manifest is invalid.");
}

if (service.endpoints.getSecurityState !== "/security/state") {
  throw new Error("Security state endpoint manifest is invalid.");
}

if (service.endpoints.getSchedules !== "/schedules") {
  throw new Error("Schedules endpoint manifest is invalid.");
}

if (service.endpoints.getScheduleRuns !== "/schedules/:id/runs") {
  throw new Error("Schedule runs endpoint manifest is invalid.");
}

if (service.endpoints.getOfficeHealth !== "/office/health") {
  throw new Error("Office health endpoint manifest is invalid.");
}

if (service.endpoints.postOfficeWriteback !== "/office/writeback") {
  throw new Error("Office writeback endpoint manifest is invalid.");
}

if (service.endpoints.officeHttpsBase !== "https://localhost:9413") {
  throw new Error("Office HTTPS base manifest is invalid.");
}

if (service.endpoints.officeProtocolFallback !== "uca://office-submit") {
  throw new Error("Office fallback protocol manifest is invalid.");
}

if (service.runtime.metrics.snapshot().queue_depth !== 0) {
  throw new Error("Metrics registry scaffold did not initialize correctly.");
}

// UCA-053 added 8 file-discovery tools; accept any count >= 21
if (service.runtime.actionToolRegistry.list().length < 21) {
  throw new Error("Action tool registry scaffold did not initialize correctly.");
}

if (service.runtime.platform.templateRegistry.list().length < 5) {
  throw new Error("Builtin template registry scaffold did not initialize correctly.");
}

if (service.runtime.platform.aiProviders.list().length < 4) {
  throw new Error("AI provider registry scaffold did not initialize correctly.");
}

const deepSeekProvider = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-chat"
};
if (resolveRoutedModel(deepSeekProvider, { model: "deepseek-chat", mode: "reasoner" }, "chat") !== "deepseek-reasoner") {
  throw new Error("DeepSeek mode routing did not resolve reasoner model.");
}

const anthropicProvider = {
  id: "claude",
  name: "Claude",
  kind: "anthropic",
  defaultModel: "claude-sonnet-4-5-20250514"
};
if (resolveRoutedModel(anthropicProvider, { model: "claude-sonnet-4-5-20250514", mode: "fast" }, "chat") !== "claude-haiku-4-5-20250514") {
  throw new Error("Anthropic mode routing did not resolve fast model.");
}

if (service.runtime.platform.codeCliAdapters.list().length < 2) {
  throw new Error("Code CLI registry scaffold did not initialize correctly.");
}

if (service.runtime.platform.mcpServers.list().length < 2) {
  throw new Error("MCP registry scaffold did not initialize correctly.");
}

if (service.runtime.platform.skillRegistries.list().length < 1) {
  throw new Error("Skill registry scaffold did not initialize correctly.");
}

// UCA-049: provider-resolver must export the commit-1 helpers that the
// submission layer depends on. This is a smoke test — full per-config
// routing behaviour is covered by verify-provider-routing.mjs.
const descriptorOfSample = describeResolvedProvider({
  id: "openai",
  configId: "deepseek",
  kind: "openai",
  model: "deepseek-chat",
  providerName: "DeepSeek"
});
if (descriptorOfSample?.provider_id !== "deepseek"
    || descriptorOfSample?.provider_kind !== "openai"
    || descriptorOfSample?.transport !== "https") {
  throw new Error("describeResolvedProvider did not return the UCA-049 event descriptor shape.");
}

const descriptorOfCli = describeResolvedProvider({
  id: "code_cli",
  configId: "my-kimi-cli",
  kind: "code_cli",
  model: "kimi-k2",
  providerName: "Kimi CLI"
});
if (descriptorOfCli?.transport !== "subprocess"
    || descriptorOfCli?.provider_id !== "my-kimi-cli") {
  throw new Error("describeResolvedProvider mis-classifies code_cli transport.");
}

// The agentic provider adapter must at least instantiate for all 4 kinds
// without throwing; commit 2 will exercise generate() more thoroughly.
for (const stubResolved of [
  { id: "openai", configId: "test", kind: "openai", model: "gpt-4o-mini", apiKey: "x", baseUrl: "https://example/v1", providerName: "OpenAI" },
  { id: "anthropic", configId: "test", kind: "anthropic", model: "claude-sonnet", apiKey: "x", baseUrl: "https://example", providerName: "Claude" },
  { id: "ollama", configId: "test", kind: "ollama", model: "llama3.2", baseUrl: "http://localhost", providerName: "Ollama" },
  { id: "code_cli", configId: "test", kind: "code_cli", model: "kimi-k2", command: "kimi.exe", providerName: "Kimi CLI" }
]) {
  const adapter = createProviderAdapter(stubResolved);
  if (!adapter || typeof adapter.generate !== "function") {
    throw new Error(`createProviderAdapter did not produce a usable adapter for kind=${stubResolved.kind}.`);
  }
}

// resolveCodeCliRuntimeForTask + resolveActiveProviderForTask should at least
// not throw when called with a null fallback on an unconfigured process.
process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = "1";
const fallbackRuntime = { command: "noop", args: [], transport: "stream_json_print", model: "test-model", providerName: "Boot Kimi" };
const cliRuntime = resolveCodeCliRuntimeForTask("chat", fallbackRuntime);
if (cliRuntime !== fallbackRuntime) {
  throw new Error("resolveCodeCliRuntimeForTask did not honour UCA_FORCE_BOOT_KIMI_RUNTIME fallback.");
}
const active = resolveActiveProviderForTask("chat", fallbackRuntime);
if (!active?.descriptor || active.descriptor.transport !== "subprocess") {
  throw new Error("resolveActiveProviderForTask did not return a subprocess descriptor for boot fallback.");
}
delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;

// UCA-048: feature flags module exports
const { isFeatureEnabled, requireFeature, listFeatureStates, FEATURE_REGISTRY } = await import("../src/service/core/feature-flags.mjs");
if (FEATURE_REGISTRY.length !== 10) {
  throw new Error(`FEATURE_REGISTRY should have 10 entries; got ${FEATURE_REGISTRY.length}`);
}
if (!isFeatureEnabled("translation")) {
  throw new Error("translation should be enabled by default (no configStore).");
}
if (!isFeatureEnabled("email_monitoring")) {
  throw new Error("email_monitoring should be enabled by default.");
}
const disabledConfigStore = {
  load() {
    return { features: { email_monitoring: { enabled: false } } };
  }
};
const gate = requireFeature("email_monitoring", disabledConfigStore);
if (gate.ok !== false || !gate.redirectTabAnchor) {
  throw new Error("requireFeature should return ok:false + anchor for a disabled feature.");
}
const states = listFeatureStates();
if (states.length !== 10 || !states.every((s) => typeof s.enabled === "boolean")) {
  throw new Error("listFeatureStates should return 10 entries with boolean enabled.");
}

console.log("Service core scaffold verification passed.");
