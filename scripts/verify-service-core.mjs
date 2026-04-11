import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
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

const decomposition = await decomposeUserCommand({
  userCommand: "翻译这段话，然后总结那份报告",
  mode: "rules_only"
});
if (decomposition.subtasks.length < 2) {
  throw new Error("Multi-intent decomposer should split simple conjunctions.");
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

if (service.runtime.actionToolRegistry.list().length !== 21) {
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

console.log("Service core scaffold verification passed.");
