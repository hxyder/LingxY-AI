import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";

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

if (!service.runtime.securityBroker) {
  throw new Error("Security broker scaffold is missing.");
}

if (!service.runtime.scheduler) {
  throw new Error("Scheduler scaffold is missing.");
}

if (!service.runtime.officeHttps) {
  throw new Error("Office HTTPS scaffold is missing.");
}

const route = service.routeIntent("请帮我总结剪贴板内容");
if (route.intent !== "summarize") {
  throw new Error("Intent router scaffold did not resolve summarize.");
}

const kimiRoute = service.routeIntent("分析这个文件并生成报告");
if (kimiRoute.executor !== "kimi") {
  throw new Error("Intent router did not resolve Kimi report flow.");
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

if (service.runtime.actionToolRegistry.list().length !== 16) {
  throw new Error("Action tool registry scaffold did not initialize correctly.");
}

console.log("Service core scaffold verification passed.");
