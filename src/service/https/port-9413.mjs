import { createSelfSignedCertPlan, explainSpikeDecision } from "./self-signed-cert.mjs";

export function createOfficeHttpsRuntime({
  port = 9413,
  selectedPath = "path_c_protocol_fallback"
} = {}) {
  const spikePlan = createSelfSignedCertPlan({
    selectedPath
  });

  return {
    port,
    protocol: "https",
    bindAddress: "localhost",
    baseUrl: `https://localhost:${port}`,
    fallbackProtocolUrl: "uca://office-submit",
    selectedPath: spikePlan.selectedPath,
    supportsWriteback: spikePlan.supportsWriteback,
    spikeSummary: explainSpikeDecision(spikePlan),
    endpoints: {
      postOfficeTask: "/office/task",
      getOfficeHealth: "/office/health",
      postOfficeWriteback: "/office/writeback"
    }
  };
}
