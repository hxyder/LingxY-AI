const DESKTOP_CAPABILITIES = Object.freeze([
  "本地工具与文件/RAG",
  "审批、任务队列和审计",
  "调度、连接器和生成文件"
]);

const STANDALONE_CAPABILITIES = Object.freeze([
  "网页内容问答",
  "直接 LLM 对话",
  "文字快捷动作"
]);

export function buildRunModeView(status = {}) {
  const capabilities = status.capabilities ?? {};
  const provider = status.provider ?? capabilities.standaloneProvider ?? "llm";

  if (status.desktopAvailable || capabilities.desktopAvailable) {
    return Object.freeze({
      mode: "desktop",
      label: "桌面程序在线",
      detail: "使用完整桌面能力，任务会送到本地桌面 runtime 处理。",
      capabilities: DESKTOP_CAPABILITIES
    });
  }

  if (status.standaloneReady || capabilities.standaloneReady) {
    const items = capabilities.canStandaloneVision
      ? [...STANDALONE_CAPABILITIES, "图片快捷分析"]
      : STANDALONE_CAPABILITIES;
    return Object.freeze({
      mode: "standalone",
      label: `独立模式 · ${provider}`,
      detail: "桌面程序未开时可临时直连模型；本地工具、文件、审批、调度和生成文件需要打开桌面程序。",
      capabilities: Object.freeze(items)
    });
  }

  return Object.freeze({
    mode: "offline",
    label: "未配置",
    detail: "请启动桌面程序，或在扩展设置里配置可用的独立模式 provider。",
    capabilities: Object.freeze(["暂无可运行后端"])
  });
}

export function formatRouteFailureMessage(routePlan = {}) {
  const reason = routePlan?.reason ?? "no_runtime";
  if (reason === "no_vision_runtime") {
    return "当前没有可用的图片分析后端。请启动 LingxY 桌面程序，或在扩展设置里配置支持图片的独立模式模型。";
  }
  if (reason === "no_runtime") {
    return "当前没有可运行后端。请启动 LingxY 桌面程序，或在扩展设置里配置独立模式 provider。";
  }
  return `当前操作无法继续：${reason}`;
}

export function renderRunModeDetail(element, view, doc = document) {
  if (!element) return;
  element.textContent = "";
  const copy = doc.createElement("p");
  copy.className = "run-mode-copy";
  copy.textContent = view.detail;
  element.appendChild(copy);

  const list = doc.createElement("ul");
  list.className = "run-mode-capabilities";
  for (const item of view.capabilities ?? []) {
    const li = doc.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  element.appendChild(list);
}
