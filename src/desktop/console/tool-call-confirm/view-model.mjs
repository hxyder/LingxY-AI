export function buildToolCallConfirmViewModel({ toolId, args, risk, mode }) {
  return {
    title: "工具调用确认",
    toolId,
    args,
    riskLevel: risk.risk_level,
    requiresConfirmation: risk.requires_confirmation,
    executionMode: mode,
    actions: ["confirm", "edit", "deny"]
  };
}
