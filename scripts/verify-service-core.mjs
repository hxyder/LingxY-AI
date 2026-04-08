import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";

const service = createServiceBootstrap();

if (service.store.engine !== "sqlite") {
  throw new Error("Expected sqlite store manifest.");
}

if (!service.runtime.executors.find((executor) => executor.id === "fast")) {
  throw new Error("Fast executor scaffold is missing.");
}

const route = service.routeIntent("请帮我总结剪贴板内容");
if (route.intent !== "summarize") {
  throw new Error("Intent router scaffold did not resolve summarize.");
}

if (service.endpoints.postTask !== "/task") {
  throw new Error("Task endpoint manifest is invalid.");
}

console.log("Service core scaffold verification passed.");
