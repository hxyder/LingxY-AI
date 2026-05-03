import { readFile } from "node:fs/promises";
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
const httpServerSource = await readFile(new URL("../src/service/core/http-server.mjs", import.meta.url), "utf8");
const aiStatusRouteSource = await readFile(new URL("../src/service/core/http-routes/ai-status-routes.mjs", import.meta.url), "utf8");
const audioRouteSource = await readFile(new URL("../src/service/core/http-routes/audio-routes.mjs", import.meta.url), "utf8");
const browserContextRouteSource = await readFile(new URL("../src/service/core/http-routes/browser-context-routes.mjs", import.meta.url), "utf8");
const officeRouteSource = await readFile(new URL("../src/service/core/http-routes/office-routes.mjs", import.meta.url), "utf8");
const previewFileRouteSource = await readFile(new URL("../src/service/core/http-routes/preview-file-routes.mjs", import.meta.url), "utf8");
const runtimeAdminRouteSource = await readFile(new URL("../src/service/core/http-routes/runtime-admin-routes.mjs", import.meta.url), "utf8");
const schedulerTemplateRouteSource = await readFile(new URL("../src/service/core/http-routes/scheduler-template-routes.mjs", import.meta.url), "utf8");
const mcpInstallRouteSource = await readFile(new URL("../src/service/core/http-routes/mcp-install-routes.mjs", import.meta.url), "utf8");
const httpRouteGuardSource = await readFile(new URL("../src/service/core/http-route-guards.mjs", import.meta.url), "utf8");
const mcpInstallExecutionSource = await readFile(new URL("../src/service/ai/mcp/install-execution.mjs", import.meta.url), "utf8");
const taskRouteSource = await readFile(new URL("../src/service/core/http-routes/task-routes.mjs", import.meta.url), "utf8");

if (!httpServerSource.includes("const routeGroups = [") || !httpServerSource.includes("tryHandleRouteGroups")) {
  throw new Error("HTTP server must dispatch delegated route modules through routeGroups.");
}
if (!httpServerSource.includes("tryHandleBrowserContextRoute")) {
  throw new Error("HTTP server must delegate browser context routes through routeGroups.");
}
if (!httpServerSource.includes("tryHandleAiStatusRoute")) {
  throw new Error("HTTP server must delegate AI status routes through routeGroups.");
}
if (!httpServerSource.includes("tryHandleTaskRoute")) {
  throw new Error("HTTP server must delegate task routes through routeGroups.");
}
if (!httpServerSource.includes("tryHandleOfficeRoute")) {
  throw new Error("HTTP server must delegate Office routes through routeGroups.");
}
if (!httpServerSource.includes("tryHandleRuntimeAdminRoute")) {
  throw new Error("HTTP server must delegate runtime admin routes through routeGroups.");
}
if (!httpServerSource.includes("tryHandleMcpInstallRoute")) {
  throw new Error("HTTP server must delegate MCP install preview routes through routeGroups.");
}
if (httpServerSource.includes('url.pathname === "/config"')) {
  throw new Error("Config read route must live in config-provider-routes.mjs, not http-server.mjs.");
}
const configProviderRouteSource = await readFile(new URL("../src/service/core/http-routes/config-provider-routes.mjs", import.meta.url), "utf8");
if (!configProviderRouteSource.includes('url.pathname === "/config"')
    || !configProviderRouteSource.includes("runtime.configStore?.load")) {
  throw new Error("config-provider-routes.mjs must own GET /config.");
}
if (!configProviderRouteSource.includes('url.pathname === "/config/mcp/servers"')
    || !configProviderRouteSource.includes('url.pathname.startsWith("/config/mcp/servers/")')
    || (configProviderRouteSource.match(/requireDesktopActor/g) ?? []).length < 2) {
  throw new Error("MCP config mutation routes must live in config-provider-routes.mjs and require the shared desktop actor guard.");
}
if (!configProviderRouteSource.includes('url.pathname === "/config/providers"')
    || !configProviderRouteSource.includes('url.pathname.startsWith("/config/providers/")')
    || (configProviderRouteSource.match(/requireDesktopActor/g) ?? []).length < 4) {
  throw new Error("Provider config mutation routes must live in config-provider-routes.mjs and require the shared desktop actor guard.");
}
if (!configProviderRouteSource.includes('url.pathname === "/config/code-cli/adapters"')
    || !configProviderRouteSource.includes('url.pathname.startsWith("/config/code-cli/adapters/")')
    || (configProviderRouteSource.match(/requireDesktopActor/g) ?? []).length < 6) {
  throw new Error("Code CLI adapter mutation routes must live in config-provider-routes.mjs and require the shared desktop actor guard.");
}
if (!configProviderRouteSource.includes('url.pathname === "/config/skills/registries"')
    || !configProviderRouteSource.includes('url.pathname.startsWith("/config/skills/registries/")')
    || (configProviderRouteSource.match(/requireDesktopActor/g) ?? []).length < 8) {
  throw new Error("Skill registry mutation routes must live in config-provider-routes.mjs and require the shared desktop actor guard.");
}
if (!configProviderRouteSource.includes('url.pathname === "/config/routing"')
    || !configProviderRouteSource.includes('url.pathname === "/config/output"')
    || !configProviderRouteSource.includes('url.pathname === "/config/features"')
    || (configProviderRouteSource.match(/requireDesktopActor/g) ?? []).length < 11) {
  throw new Error("Runtime config mutation routes must live in config-provider-routes.mjs and require the shared desktop actor guard.");
}
if (configProviderRouteSource.includes('url.pathname === "/config/mcp/install/preview"')) {
  throw new Error("MCP install preview route must live in mcp-install-routes.mjs, not config-provider-routes.mjs.");
}
if (!mcpInstallRouteSource.includes('url.pathname === "/config/mcp/install/preview"')
    || !mcpInstallRouteSource.includes('url.pathname === "/config/mcp/install/plan"')
    || !mcpInstallRouteSource.includes('url.pathname === "/config/mcp/install/run"')
    || !mcpInstallRouteSource.includes("detectMcpInstallCandidate")
    || !mcpInstallRouteSource.includes("createMcpInstallSandboxPlan")
    || !mcpInstallRouteSource.includes("executeMcpInstall")
    || !mcpInstallRouteSource.includes("requireDesktopActor")
    || mcpInstallRouteSource.includes("saveRuntimeConfig")) {
  throw new Error("mcp-install-routes.mjs must own MCP install plan/preview/run without writing config.");
}
if ((mcpInstallRouteSource.match(/requireDesktopActor/g) ?? []).length < 2) {
  throw new Error("MCP install preview and run routes must both require the shared desktop actor guard.");
}
if (!httpRouteGuardSource.includes("DESKTOP_ACTOR_HEADER")
    || !httpRouteGuardSource.includes("desktop_actor_required")
    || !httpRouteGuardSource.includes("requireDesktopActor")) {
  throw new Error("High-effect local mutation routes must use the shared desktop actor guard.");
}
if (/Access-Control-Allow-Headers[^\n]+x-lingxy-desktop-actor/i.test(httpServerSource)) {
  throw new Error("Desktop actor header must not be allowed through generic browser CORS.");
}
if (!mcpInstallExecutionSource.includes("spawnExternal")
    || /\bspawn\s*\(/.test(mcpInstallExecutionSource)
    || /\bexecFile\s*\(/.test(mcpInstallExecutionSource)
    || mcpInstallExecutionSource.includes("saveRuntimeConfig")) {
  throw new Error("MCP install execution must use external-call spawn wrapper and must not write config.");
}
if (httpServerSource.includes('url.pathname === "/note/transcribe"') || httpServerSource.includes('url.pathname === "/echo/kws"')) {
  throw new Error("Audio, Echo KWS, and note transcription routes must live in audio-routes.mjs, not http-server.mjs.");
}
if (!audioRouteSource.includes('url.pathname === "/note/transcribe"')
    || !audioRouteSource.includes('url.pathname === "/echo/kws"')
    || !audioRouteSource.includes('url.pathname === "/echo/enroll-keyword"')) {
  throw new Error("audio-routes.mjs must own note transcription and Echo wake-word routes.");
}
if (httpServerSource.includes('url.pathname === "/file/render-preview-html"')
    || httpServerSource.includes('url.pathname === "/preview/status"')
    || httpServerSource.includes('url.pathname === "/file/extract-text"')) {
  throw new Error("Preview and file-render routes must live in preview-file-routes.mjs, not http-server.mjs.");
}
if (!previewFileRouteSource.includes('url.pathname === "/file/render-preview-html"')
    || !previewFileRouteSource.includes('url.pathname === "/file/pdf"')
    || !previewFileRouteSource.includes('url.pathname === "/preview/status"')
    || !previewFileRouteSource.includes('url.pathname === "/preview/cache/clear"')
    || !previewFileRouteSource.includes('url.pathname === "/file/extract-text"')) {
  throw new Error("preview-file-routes.mjs must own preview/file render endpoints.");
}
if (httpServerSource.includes('url.pathname === "/location"')
    || httpServerSource.includes('url.pathname === "/overlay/handoff"')
    || httpServerSource.includes('url.pathname === "/page/explain"')
    || httpServerSource.includes('url.pathname === "/browser/context"')) {
  throw new Error("Browser context, location, overlay handoff, and page explain routes must live in browser-context-routes.mjs, not http-server.mjs.");
}
if (!browserContextRouteSource.includes('url.pathname === "/location"')
    || !browserContextRouteSource.includes('url.pathname === "/location/windows"')
    || !browserContextRouteSource.includes('url.pathname === "/overlay/handoff"')
    || !browserContextRouteSource.includes('url.pathname === "/page/explain"')
    || !browserContextRouteSource.includes('url.pathname === "/browser/context"')
    || !browserContextRouteSource.includes('url.pathname === "/browser/context/recent"')) {
  throw new Error("browser-context-routes.mjs must own browser context, location, handoff, and page explain endpoints.");
}
if (httpServerSource.includes('url.pathname === "/executors"')
    || httpServerSource.includes('url.pathname === "/ai/providers"')
    || httpServerSource.includes('url.pathname === "/ai/code-cli"')
    || httpServerSource.includes('url.pathname === "/ai/mcp"')
    || httpServerSource.includes('url.pathname === "/ai/skills"')) {
  throw new Error("AI status and executor catalog routes must live in ai-status-routes.mjs, not http-server.mjs.");
}
if (!aiStatusRouteSource.includes('url.pathname === "/executors"')
    || !aiStatusRouteSource.includes('url.pathname === "/ai/providers"')
    || !aiStatusRouteSource.includes('url.pathname === "/ai/code-cli"')
    || !aiStatusRouteSource.includes('url.pathname === "/ai/mcp"')
    || !aiStatusRouteSource.includes('url.pathname === "/ai/skills"')
    || !aiStatusRouteSource.includes('/^\\/ai\\/mcp\\/[^/]+\\/toggle$/')
    || !aiStatusRouteSource.includes('/^\\/ai\\/mcp\\/[^/]+\\/config$/')) {
  throw new Error("ai-status-routes.mjs must own executor catalog and AI provider/code-cli/MCP/skill status endpoints.");
}
if ((aiStatusRouteSource.match(/requireDesktopActor/g) ?? []).length < 2) {
  throw new Error("MCP runtime mutation routes must require the shared desktop actor guard.");
}
if (httpServerSource.includes('url.pathname === "/task"')
    || httpServerSource.includes('url.pathname === "/task/clarify"')
    || httpServerSource.includes('url.pathname === "/tasks"')
    || httpServerSource.includes('url.pathname === "/tasks/summary"')
    || httpServerSource.includes('url.pathname === "/tasks/failed"')
    || httpServerSource.includes('url.pathname === "/context"')
    || httpServerSource.includes("readTaskEventLog")
    || httpServerSource.includes("submitTaskFromBody")
    || httpServerSource.includes("mergeArtifactsForTask")) {
  throw new Error("Task submission, task summary/detail, task events, and context preview routes must live in task-routes.mjs, not http-server.mjs.");
}
if (!taskRouteSource.includes('url.pathname === "/task"')
    || !taskRouteSource.includes('url.pathname === "/task/clarify"')
    || !taskRouteSource.includes('url.pathname === "/tasks"')
    || !taskRouteSource.includes('url.pathname === "/tasks/summary"')
    || !taskRouteSource.includes('url.pathname === "/tasks/failed"')
    || !taskRouteSource.includes('url.pathname === "/context"')
    || !taskRouteSource.includes("readTaskEventLog")
    || !taskRouteSource.includes("createTaskEventStream")
    || !taskRouteSource.includes("mergeArtifactsForTask")) {
  throw new Error("task-routes.mjs must own task submission, task summary/detail, task events, and context preview endpoints.");
}
if (httpServerSource.includes('url.pathname.startsWith("/office/")')
    || httpServerSource.includes('url.pathname === "/setup/office-addins/status"')
    || httpServerSource.includes('url.pathname === "/setup/office-addins"')
    || httpServerSource.includes("runOfficeAddinSetup")) {
  throw new Error("Office static/setup routes must live in office-routes.mjs, not http-server.mjs.");
}
if (!officeRouteSource.includes('url.pathname.startsWith("/office/")')
    || !officeRouteSource.includes('url.pathname === "/setup/office-addins/status"')
    || !officeRouteSource.includes('url.pathname === "/setup/office-addins"')
    || !officeRouteSource.includes("setup-office-addins.ps1")) {
  throw new Error("office-routes.mjs must own Office static files and setup endpoints.");
}
if (httpServerSource.includes('url.pathname === "/health"')
    || httpServerSource.includes('url.pathname === "/metrics"')
    || httpServerSource.includes('url.pathname === "/approvals"')
    || httpServerSource.includes('url.pathname === "/audit-log"')
    || httpServerSource.includes('url.pathname === "/security/state"')
    || httpServerSource.includes('url.pathname === "/budget"')
    || httpServerSource.includes('url.pathname === "/history/search"')) {
  throw new Error("Runtime admin routes must live in runtime-admin-routes.mjs, not http-server.mjs.");
}
if (!runtimeAdminRouteSource.includes('url.pathname === "/health"')
    || !runtimeAdminRouteSource.includes('url.pathname === "/metrics"')
    || !runtimeAdminRouteSource.includes('url.pathname === "/approvals"')
    || !runtimeAdminRouteSource.includes('url.pathname === "/audit-log"')
    || !runtimeAdminRouteSource.includes('url.pathname === "/security/state"')
    || !runtimeAdminRouteSource.includes('url.pathname === "/budget"')
    || !runtimeAdminRouteSource.includes('url.pathname === "/history/search"')
    || !runtimeAdminRouteSource.includes('/^\\/approvals\\/([^/]+)\\/approve$/')
    || !runtimeAdminRouteSource.includes('/^\\/approvals\\/([^/]+)\\/reject$/')) {
  throw new Error("runtime-admin-routes.mjs must own health, metrics, approvals, audit, security, budget, and history endpoints.");
}
if ((runtimeAdminRouteSource.match(/requireDesktopActor/g) ?? []).length < 4) {
  throw new Error("Runtime admin mutation routes must require the shared desktop actor guard.");
}
if (!schedulerTemplateRouteSource.includes('url.pathname === "/schedules"')
    || !schedulerTemplateRouteSource.includes('/^\\/schedules\\/([^/]+)$/')
    || !schedulerTemplateRouteSource.includes('/^\\/schedules\\/([^/]+)\\/runs$/')) {
  throw new Error("scheduler-template-routes.mjs must own schedule create/update/delete/run endpoints.");
}
if ((schedulerTemplateRouteSource.match(/requireDesktopActor/g) ?? []).length < 8) {
  throw new Error("Schedule, template, and DAG execution mutation routes must require the shared desktop actor guard.");
}

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
    text: "",
    // P4-RQ E3 stage C1: topic regex no longer drives required.
    // Stub SR so the merge upgrades web → required for the news
    // command. Conservative-fallback path lives in routing-policy
    // fixtures (news-no-sr-conservative-fallback).
    semantic_router_decision: {
      source_scope: "external_world",
      web_policy: "required",
      output_kind: "pptx",
      artifact_required: true,
      executor: "agentic",
      research_depth: "multi_source",
      confidence: 0.85,
      reason: "news + artifact"
    }
  },
  userCommand: "搜索最新 AI 新闻并生成一份 ppt"
});
if (!latestTask.task_spec || latestTask.task_spec_valid !== true) {
  throw new Error(`TaskSpec was not attached to created task: ${(latestTask.task_spec_errors ?? []).join("; ")}`);
}
// P4-00.7 (revised §18.6.1.A): the requirement now lives in the group-level
// field, not the toolId-level one — the LLM may satisfy it by calling any
// member of `external_web_read` (web_search_fetch / web_search /
// fetch_url_content), so binding the test to one specific tool name is
// exactly the contradiction the revision removed.
if (!latestTask.task_spec.needs_current_web_data
    || !latestTask.task_spec.success_contract.required_policy_groups.includes("external_web_read")) {
  throw new Error("TaskSpec must require external_web_read group for latest/current tasks.");
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
    text: "",
    // P4-RQ E3 stage C1: stub SR for the geopolitics+stocks topic
    // so the merge upgrades web=required (was driven by entity regex).
    semantic_router_decision: {
      source_scope: "external_world",
      web_policy: "required",
      output_kind: "docx",
      artifact_required: true,
      executor: "agentic",
      research_depth: "multi_source",
      confidence: 0.85,
      reason: "geopolitics + stock research with artifact"
    }
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

// In the single-brain architecture, a text-only "请分析这张图片" with no
// image actually attached routes to tool_using — the agent-loop's LLM
// sees "Attached files: (none)" in its resource block and either asks the
// user to upload an image or works with inline context. Real image-in-hand
// tasks come through submitImageTask which sets executorOverride directly,
// bypassing routeIntent for the multi_modal decision.
// In the single-brain architecture, a text-only "请分析这张图片" with no
// image actually attached routes to an executor with a tool belt
// (tool_using or agentic — both can drive agent-loop). The LLM sees
// "Attached files: (none)" in its resource block and either asks the user
// to upload an image or works with inline context. Real image-in-hand
// tasks come through submitImageTask which sets executorOverride directly,
// bypassing routeIntent for the multi_modal decision.
const imageRoute = service.routeIntent("请分析这张图片");
if (!["tool_using", "agentic"].includes(imageRoute.executor)) {
  throw new Error(`Text-only image-analysis command should route to a tool-capable executor (got ${imageRoute.executor}); the agent-loop handles the no-attachment case.`);
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
  defaultModel: "deepseek-v4-flash"
};
// UCA-182 Phase 19: v4 modes ("flash" / "pro") + legacy aliases.
if (resolveRoutedModel(deepSeekProvider, { model: "deepseek-v4-flash", mode: "pro" }, "chat") !== "deepseek-v4-pro") {
  throw new Error("DeepSeek mode routing did not resolve v4-pro model.");
}
// Legacy id aliasing — saved taskRouting with mode="reasoner" must
// keep resolving to deepseek-reasoner until the 2026-07 retirement.
if (resolveRoutedModel(deepSeekProvider, { model: "deepseek-chat", mode: "reasoner" }, "chat") !== "deepseek-reasoner") {
  throw new Error("DeepSeek legacy mode alias did not resolve reasoner model.");
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
if (FEATURE_REGISTRY.length !== 11) {
  throw new Error(`FEATURE_REGISTRY should have 11 entries; got ${FEATURE_REGISTRY.length}`);
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
if (states.length !== 11 || !states.every((s) => typeof s.enabled === "boolean")) {
  throw new Error("listFeatureStates should return 11 entries with boolean enabled.");
}

console.log("Service core scaffold verification passed.");
