export function buildBudgetDashboardViewModel({
  budgetState,
  pricingEntries = []
}) {
  return {
    title: "预算与配额",
    monthlyLimitUsd: budgetState?.limits?.monthly_usd_limit ?? 0,
    perTaskLimitUsd: budgetState?.limits?.per_task_usd_limit ?? 0,
    warnAtPercent: budgetState?.limits?.warn_at_percent ?? 0,
    hardStopAtPercent: budgetState?.limits?.hard_stop_at_percent ?? 0,
    spentUsd: budgetState?.spent?.this_month_usd ?? 0,
    spentTokensIn: budgetState?.spent?.this_month_tokens_in ?? 0,
    spentTokensOut: budgetState?.spent?.this_month_tokens_out ?? 0,
    pricingEntries
  };
}
