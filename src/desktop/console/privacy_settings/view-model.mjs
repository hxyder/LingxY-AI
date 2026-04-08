export function buildPrivacySettingsViewModel(securityConfig) {
  return {
    killSwitchEnabled: securityConfig.global_kill_switch,
    offlineMode: securityConfig.offline_mode,
    presenterMode: securityConfig.presenter_mode,
    redactionRules: securityConfig.field_redaction?.enabled_rules ?? [],
    retention: securityConfig.data_retention ?? {}
  };
}
