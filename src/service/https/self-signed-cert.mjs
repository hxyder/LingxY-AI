export const OFFICE_HTTPS_SPIKE_OPTIONS = Object.freeze([
  {
    id: "path_a_localhost_https",
    title: "Localhost HTTPS with self-signed root",
    url: "https://localhost:9413",
    risk: "high",
    supportsWriteback: true
  },
  {
    id: "path_b_remote_shell_local_companion",
    title: "Remote Office shell with local companion",
    url: "https://localhost:9413",
    risk: "medium",
    supportsWriteback: true
  },
  {
    id: "path_c_protocol_fallback",
    title: "Protocol handler fallback",
    url: "uca://office-submit",
    risk: "low",
    supportsWriteback: false
  }
]);

export function createSelfSignedCertPlan({
  selectedPath = "path_c_protocol_fallback",
  timeboxDays = 5
} = {}) {
  const option = OFFICE_HTTPS_SPIKE_OPTIONS.find((item) => item.id === selectedPath) ?? OFFICE_HTTPS_SPIKE_OPTIONS[2];
  return {
    selectedPath: option.id,
    timeboxDays,
    baseUrl: option.url,
    supportsWriteback: option.supportsWriteback,
    enterpriseLimitations: [
      "Group Policy may block trust-root installation.",
      "Localhost TLS can still fail inside hardened Office environments.",
      "Corporate proxy or SSL inspection policies may require a remote shell path."
    ]
  };
}

export function explainSpikeDecision(plan = createSelfSignedCertPlan()) {
  if (plan.selectedPath === "path_c_protocol_fallback") {
    return "Selected protocol-handler fallback for Phase 4 base ship; localhost HTTPS remains an enhancement track.";
  }
  return `Selected ${plan.selectedPath} for Office integration.`;
}
