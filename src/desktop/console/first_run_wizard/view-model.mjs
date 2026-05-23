import { t } from "../../../shared/i18n/index.mjs";
import { buildProviderSetupStatus } from "../../../shared/provider-setup-status.mjs";

function inferLlmStatus({ codeCliAdapters = [], providers = [], locale = "zh-CN" } = {}) {
  const providerSetup = buildProviderSetupStatus({ providers, codeCliAdapters, locale });
  const kimi = codeCliAdapters.find((adapter) => adapter.id === "kimi-code-cli");
  if (kimi?.available) {
    return {
      status: "ready",
      detail: t(locale, "firstRun.llm.kimiReady"),
      recommended: "code_cli",
      providerSetup
    };
  }

  if (kimi?.configured) {
    return {
      status: "configured",
      detail: t(locale, "firstRun.llm.kimiConfiguredUnavailable"),
      recommended: "code_cli",
      providerSetup
    };
  }

  const provider = providers.find((item) => item.available && item.configured);
  if (provider) {
    return {
      status: "ready",
      detail: t(locale, "firstRun.llm.providerAvailable", {
        providerName: provider.displayName ?? provider.name ?? provider.id ?? "Provider"
      }),
      recommended: "provider",
      providerSetup
    };
  }

  if (providerSetup.hasConfiguredRuntime) {
    return {
      status: "configured",
      detail: providerSetup.primaryIssue?.detail ?? t(locale, "firstRun.llm.providerSavedNeedsCheck"),
      recommended: "provider",
      providerSetup
    };
  }

  return {
    status: "action_needed",
    detail: t(locale, "firstRun.llm.actionNeeded"),
    recommended: "provider",
    providerSetup
  };
}

export function buildFirstRunWizardViewModel({
  permissions = {},
  integrations = {},
  codeCliAdapters = [],
  providers = [],
  locale = "zh-CN"
} = {}) {
  const llmStatus = inferLlmStatus({ codeCliAdapters, providers, locale });
  return {
    providerSetup: llmStatus.providerSetup,
    locale,
    steps: [
      { id: "welcome", title: t(locale, "firstRun.welcome.title"), optional: false, status: "ready" },
      {
        id: "clipboard",
        title: t(locale, "firstRun.clipboard.title"),
        optional: true,
        status: permissions.clipboard === false ? "action_needed" : "ready"
      },
      {
        id: "file_access",
        title: t(locale, "firstRun.fileAccess.title"),
        optional: true,
        status: integrations.fileEntry?.installed ? "ready" : "recommended",
        detail: integrations.fileEntry?.detail ?? t(locale, "firstRun.fileAccess.detail")
      },
      {
        id: "browser_extension",
        title: t(locale, "firstRun.browserExtension.title"),
        optional: true,
        status: integrations.browserExtension?.installed ? "ready" : "optional",
        detail: integrations.browserExtension?.detail ?? t(locale, "firstRun.browserExtension.detail")
      },
      {
        id: "llm_backend",
        title: t(locale, "firstRun.llmBackend.title"),
        optional: false,
        status: llmStatus.status,
        detail: llmStatus.detail,
        recommended: llmStatus.recommended
      }
    ],
    recommendedPath: llmStatus.recommended,
    nextAction: llmStatus.status === "ready"
      ? "open_console"
      : "setup_provider"
  };
}
