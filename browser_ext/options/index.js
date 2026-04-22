import {
  DEFAULT_RUNTIME_URL,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_GROUPS,
  normalizeStandaloneConfig
} from "../shared/provider-catalog.js";

// Extension options page — persists user's LLM config + desktop URL so the
// service worker can fall back to a direct API call when the desktop runtime
// isn't available. Key is stored in chrome.storage.local only; no telemetry.

const runtimeInput = document.getElementById("runtime-url");
const providerSelect = document.getElementById("provider");
const apiKeyInput = document.getElementById("api-key");
const modelInput = document.getElementById("model");
const saveBtn = document.getElementById("save-btn");
const testBtn = document.getElementById("test-btn");
const saveStatus = document.getElementById("save-status");
const statusDesktop = document.getElementById("status-desktop");
const statusKey = document.getElementById("status-key");

function renderProviderOptions() {
  providerSelect.innerHTML = PROVIDER_GROUPS.map((group) => `
    <optgroup label="${group.label}">
      ${group.providers.map((provider) => `<option value="${provider.id}">${provider.label}</option>`).join("")}
    </optgroup>
  `).join("");
}

async function loadConfig() {
  const data = await chrome.storage.local.get("ucaStandaloneConfig");
  return normalizeStandaloneConfig(data.ucaStandaloneConfig ?? {
    runtimeUrl: DEFAULT_RUNTIME_URL,
    provider: "anthropic",
    apiKey: "",
    model: PROVIDER_DEFAULT_MODELS.anthropic
  });
}

async function saveConfig(config) {
  await chrome.storage.local.set({ ucaStandaloneConfig: normalizeStandaloneConfig(config) });
}

function renderConfig(config) {
  runtimeInput.value = config.runtimeUrl ?? DEFAULT_RUNTIME_URL;
  providerSelect.value = config.provider ?? "anthropic";
  apiKeyInput.value = config.apiKey ?? "";
  modelInput.value = config.model ?? PROVIDER_DEFAULT_MODELS[providerSelect.value];
  renderStatus(config);
}

function renderStatus(config) {
  statusKey.textContent = config.apiKey ? `${config.provider} · 已配置` : "未配置";
  statusKey.className = `status-value ${config.apiKey ? "ok" : "warn"}`;
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

const DEFAULT_MODEL_SET = new Set(Object.values(PROVIDER_DEFAULT_MODELS));
providerSelect.addEventListener("change", () => {
  // Auto-swap the model hint when the user hasn't typed a custom one (empty
  // or currently showing another provider's default). If they typed something
  // hand-picked we leave it alone.
  if (!modelInput.value || DEFAULT_MODEL_SET.has(modelInput.value)) {
    modelInput.value = PROVIDER_DEFAULT_MODELS[providerSelect.value] ?? "";
  }
});

saveBtn.addEventListener("click", async () => {
  const config = normalizeStandaloneConfig({
    runtimeUrl: runtimeInput.value.trim() || DEFAULT_RUNTIME_URL,
    provider: providerSelect.value,
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || PROVIDER_DEFAULT_MODELS[providerSelect.value]
  });
  renderConfig(config);
  await saveConfig(config);
  saveStatus.textContent = "已保存";
  renderStatus(config);
  setTimeout(() => { saveStatus.textContent = ""; }, 2000);
  probeDesktop(config.runtimeUrl);
});

testBtn.addEventListener("click", async () => {
  const config = normalizeStandaloneConfig({
    runtimeUrl: runtimeInput.value.trim() || DEFAULT_RUNTIME_URL,
    provider: providerSelect.value,
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || PROVIDER_DEFAULT_MODELS[providerSelect.value]
  });
  renderConfig(config);
  if (!config.apiKey) {
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
})();
