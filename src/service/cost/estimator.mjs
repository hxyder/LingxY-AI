import pricing from "./pricing.mjs";

export function estimateTaskCost({
  executorId,
  tokensIn = 0,
  tokensOut = 0
}) {
  const rates = pricing.executors[executorId] ?? { in: 0, out: 0 };
  const usd = ((tokensIn / 1000000) * rates.in) + ((tokensOut / 1000000) * rates.out);
  return {
    executorId,
    tokensIn,
    tokensOut,
    usd: Number(usd.toFixed(6))
  };
}

export function estimateTemplateCost(template, executorId = "local.fast") {
  return estimateTaskCost({
    executorId,
    tokensIn: template.cost_estimate?.tokens_in ?? 0,
    tokensOut: template.cost_estimate?.tokens_out ?? 0
  });
}
