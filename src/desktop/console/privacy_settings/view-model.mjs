import { buildPrivacySandboxSummary } from "../../../shared/privacy-sandbox-policy.mjs";

export function buildPrivacySettingsViewModel(securityConfig) {
  return {
    killSwitchEnabled: securityConfig.global_kill_switch,
    offlineMode: securityConfig.offline_mode,
    presenterMode: securityConfig.presenter_mode,
    sandbox: buildPrivacySandboxSummary(securityConfig),
    redactionRules: securityConfig.field_redaction?.enabled_rules ?? [],
    retention: securityConfig.data_retention ?? {}
  };
}
