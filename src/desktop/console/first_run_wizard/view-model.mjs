function inferLlmStatus({ codeCliAdapters = [], providers = [] } = {}) {
  const kimi = codeCliAdapters.find((adapter) => adapter.id === "kimi-code-cli");
  if (kimi?.available) {
    return {
      status: "ready",
      detail: "Kimi Code CLI is ready",
      recommended: "code_cli"
    };
  }

  if (kimi?.configured) {
    return {
      status: "configured",
      detail: "Kimi CLI is configured but not available",
      recommended: "code_cli"
    };
  }

  const provider = providers.find((item) => item.available && item.configured);
  if (provider) {
    return {
      status: "ready",
      detail: `${provider.displayName} is available`,
      recommended: "provider"
    };
  }

  return {
    status: "action_needed",
    detail: "Install and log into Kimi Code CLI first",
    recommended: "code_cli"
  };
}

export function buildFirstRunWizardViewModel({
  permissions = {},
  integrations = {},
  codeCliAdapters = [],
  providers = []
} = {}) {
  const llmStatus = inferLlmStatus({ codeCliAdapters, providers });
  return {
    steps: [
      { id: "welcome", title: "欢迎", optional: false, status: "ready" },
      {
        id: "clipboard",
        title: "剪贴板权限",
        optional: true,
        status: permissions.clipboard === false ? "action_needed" : "ready"
      },
      {
        id: "file_access",
        title: "文件权限",
        optional: true,
        status: integrations.fileEntry?.installed ? "ready" : "recommended",
        detail: integrations.fileEntry?.detail ?? "Explorer / uca-cli entry is optional but recommended"
      },
      {
        id: "browser_extension",
        title: "浏览器扩展",
        optional: true,
        status: integrations.browserExtension?.installed ? "ready" : "optional",
        detail: integrations.browserExtension?.detail ?? "Install later if you need webpage capture"
      },
      {
        id: "llm_backend",
        title: "LLM 后端",
        optional: false,
        status: llmStatus.status,
        detail: llmStatus.detail,
        recommended: llmStatus.recommended
      }
    ],
    recommendedPath: llmStatus.recommended,
    nextAction: llmStatus.status === "ready"
      ? "open_console"
      : "setup_kimi_code_cli"
  };
}
