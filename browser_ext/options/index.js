import {
  DEFAULT_RUNTIME_URL,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_GROUPS,
  isStandaloneProviderConfigured,
  modelOptionsForProvider,
  normalizeStandaloneConfig,
  providerRequiresApiKey,
  providerSupportsVision,
  reasoningOptionsForProvider
} from "../shared/provider-catalog.js";
import {
  discoverProviderModels,
  invalidateProviderModelCache
} from "../shared/model-discovery.js";

const runtimeInput = document.getElementById("runtime-url");
const providerSelect = document.getElementById("provider");
const apiKeyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const customModelField = document.getElementById("custom-model-field");
const customModelInput = document.getElementById("custom-model");
const reasoningField = document.getElementById("reasoning-field");
const reasoningSelect = document.getElementById("reasoning");
const providerHint = document.getElementById("provider-hint");
const saveBtn = document.getElementById("save-btn");
const testBtn = document.getElementById("test-btn");
const saveStatus = document.getElementById("save-status");
const statusDesktop = document.getElementById("status-desktop");
const statusKey = document.getElementById("status-key");
let discoveredModels = [];
let modelRefreshToken = 0;
let refreshModelsTimer = null;

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = String(value ?? "");
  option.textContent = String(label ?? "");
  return option;
}

function renderProviderOptions() {
  const groups = PROVIDER_GROUPS.map((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    optgroup.replaceChildren(...group.providers.map((provider) => createOption(provider.id, provider.label)));
    return optgroup;
  });
  providerSelect.replaceChildren(...groups);
}

function renderModelOptions(provider, currentModel = "") {
  const options = modelOptionsForProvider(provider, discoveredModels);
  const selectedModel = currentModel && !options.includes(currentModel) ? "__custom__" : (currentModel || options[0] || "");
  modelSelect.replaceChildren(
    ...options.map((model) => createOption(model, model)),
    createOption("__custom__", "自定义…")
  );
  modelSelect.value = selectedModel;
  customModelField.hidden = selectedModel !== "__custom__";
  customModelInput.value = selectedModel === "__custom__" ? currentModel : "";
}

function renderReasoningOptions(provider, model, currentReasoning = "") {
  const options = reasoningOptionsForProvider(provider, model);
  reasoningField.hidden = options.length === 0;
  reasoningSelect.replaceChildren(...options.map((option) => createOption(option.id, option.label)));
  reasoningSelect.value = options.some((option) => option.id === currentReasoning) ? currentReasoning : (options[0]?.id ?? "");
}

function updateProviderHint(provider, model) {
  const vision = providerSupportsVision(provider, model) ? "支持图片直连" : "图片直连可能不可用";
  providerHint.textContent = `${vision}。Key 使用 chrome.storage.local 保存，不会离开您的浏览器。Anthropic 需要 CORS header「anthropic-dangerous-direct-browser-access: true」（扩展已内置）。Ollama 需本地已启动并监听 11434。`;
}

async function refreshModelOptions({ force = false, preserveCurrent = true } = {}) {
  const token = ++modelRefreshToken;
  const provider = providerSelect.value;
  const currentModel = preserveCurrent
    ? (selectedModelValue() || PROVIDER_DEFAULT_MODELS[provider] || "")
    : (PROVIDER_DEFAULT_MODELS[provider] || "");
  const apiKey = apiKeyInput.value.trim();

  modelSelect.disabled = true;
  modelSelect.replaceChildren(createOption(currentModel || "", "加载模型列表中…"));
  if (currentModel) modelSelect.value = currentModel;

  const result = await discoverProviderModels(provider, { apiKey, forceRefresh: force });
  if (token !== modelRefreshToken) return;
  discoveredModels = result.models ?? [];
  renderModelOptions(provider, currentModel);
  syncModelAndReasoning();
  modelSelect.disabled = false;
  if (result.error) {
    saveStatus.textContent = `模型列表已回退到内置值：${result.error}`;
  } else if (result.dynamic) {
    saveStatus.textContent = "模型列表已更新";
  }
}

function scheduleModelRefresh(options = {}) {
  clearTimeout(refreshModelsTimer);
  refreshModelsTimer = setTimeout(() => {
    refreshModelOptions(options);
  }, 250);
}

async function loadConfig() {
  const data = await chrome.storage.local.get("ucaStandaloneConfig");
  return normalizeStandaloneConfig(data.ucaStandaloneConfig ?? {
    runtimeUrl: DEFAULT_RUNTIME_URL,
    provider: "anthropic",
    apiKey: "",
    model: PROVIDER_DEFAULT_MODELS.anthropic,
    reasoningEffort: ""
  });
}

async function saveConfig(config) {
  await chrome.storage.local.set({ ucaStandaloneConfig: normalizeStandaloneConfig(config) });
}

function selectedModelValue() {
  return modelSelect.value === "__custom__"
    ? customModelInput.value.trim()
    : modelSelect.value.trim();
}

function readFormConfig() {
  return normalizeStandaloneConfig({
    runtimeUrl: runtimeInput.value.trim() || DEFAULT_RUNTIME_URL,
    provider: providerSelect.value,
    apiKey: apiKeyInput.value.trim(),
    model: selectedModelValue() || PROVIDER_DEFAULT_MODELS[providerSelect.value],
    reasoningEffort: reasoningField.hidden ? "" : reasoningSelect.value
  });
}

function renderStatus(config) {
  const extras = [];
  if (config.model) extras.push(config.model);
  if (config.reasoningEffort) extras.push(config.reasoningEffort);
  const configured = isStandaloneProviderConfigured(config);
  statusKey.textContent = configured ? `${config.provider} · ${extras.join(" · ")}` : "未配置";
  statusKey.className = `status-value ${configured ? "ok" : "warn"}`;
}

function renderConfig(config) {
  runtimeInput.value = config.runtimeUrl ?? DEFAULT_RUNTIME_URL;
  providerSelect.value = config.provider ?? "anthropic";
  apiKeyInput.value = config.apiKey ?? "";
  renderModelOptions(providerSelect.value, config.model ?? PROVIDER_DEFAULT_MODELS[providerSelect.value]);
  renderReasoningOptions(providerSelect.value, config.model ?? "", config.reasoningEffort ?? "");
  updateProviderHint(providerSelect.value, config.model ?? "");
  renderStatus(config);
}

async function probeDesktop(url) {
  if (!url) return { ok: false };
  statusDesktop.textContent = "检测中…";
  statusDesktop.className = "status-value";
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(t);
    if (response.ok) {
      statusDesktop.textContent = "在线";
      statusDesktop.className = "status-value ok";
      return { ok: true };
    }
    statusDesktop.textContent = `响应 ${response.status}`;
    statusDesktop.className = "status-value warn";
    return { ok: false, status: response.status };
  } catch (error) {
    statusDesktop.textContent = "未启动（将走直连）";
    statusDesktop.className = "status-value warn";
    return { ok: false, error: error?.message };
  }
}

function syncModelAndReasoning() {
  const model = selectedModelValue() || PROVIDER_DEFAULT_MODELS[providerSelect.value] || "";
  renderReasoningOptions(providerSelect.value, model, reasoningSelect.value);
  updateProviderHint(providerSelect.value, model);
}

providerSelect.addEventListener("change", () => {
  discoveredModels = [];
  renderModelOptions(providerSelect.value, PROVIDER_DEFAULT_MODELS[providerSelect.value] ?? "");
  syncModelAndReasoning();
  refreshModelOptions({ force: true, preserveCurrent: false });
});

modelSelect.addEventListener("change", () => {
  customModelField.hidden = modelSelect.value !== "__custom__";
  if (modelSelect.value !== "__custom__") customModelInput.value = "";
  syncModelAndReasoning();
});

customModelInput.addEventListener("input", syncModelAndReasoning);
apiKeyInput.addEventListener("change", () => {
  invalidateProviderModelCache(providerSelect.value, apiKeyInput.value.trim());
  refreshModelOptions({ force: true });
});
apiKeyInput.addEventListener("input", () => {
  invalidateProviderModelCache(providerSelect.value, apiKeyInput.value.trim());
  scheduleModelRefresh({ force: true });
});

saveBtn.addEventListener("click", async () => {
  const config = readFormConfig();
  renderConfig(config);
  await saveConfig(config);
  saveStatus.textContent = "已保存";
  setTimeout(() => { saveStatus.textContent = ""; }, 2000);
  probeDesktop(config.runtimeUrl);
});

testBtn.addEventListener("click", async () => {
  const config = readFormConfig();
  renderConfig(config);
  if (providerRequiresApiKey(config.provider) && !config.apiKey) {
    saveStatus.textContent = "先填 API Key";
    return;
  }
  testBtn.disabled = true;
  saveStatus.textContent = "测试中…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "uca.standalone.test",
      config,
      prompt: "ping"
    });
    if (response?.ok) {
      saveStatus.textContent = `成功（${response.text?.slice(0, 30) ?? ""}）`;
    } else {
      saveStatus.textContent = `失败：${response?.error ?? "unknown"}`;
    }
  } catch (error) {
    saveStatus.textContent = `失败：${error?.message ?? error}`;
  } finally {
    testBtn.disabled = false;
  }
});

(async () => {
  renderProviderOptions();
  const config = await loadConfig();
  await saveConfig(config);
  renderConfig(config);
  probeDesktop(config.runtimeUrl);
  await refreshModelOptions({ force: true });
})();
