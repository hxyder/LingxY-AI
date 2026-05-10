const MODES = Object.freeze(["standard", "local_only"]);

function normalizeMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  return MODES.includes(mode) ? mode : "standard";
}

function normalizeSwitch(value, fallback = "allow") {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "block" || text === "blocked" ? "block" : fallback;
}

function capabilitiesOf(tool = {}) {
  return Array.isArray(tool.required_capabilities)
    ? tool.required_capabilities.map((capability) => String(capability))
    : [];
}

export function normalizePrivacySandboxPolicy(config = {}) {
  const sandbox = config.privacy_sandbox ?? {};
  const mode = normalizeMode(sandbox.mode);
  return {
    mode,
    network: mode === "local_only" ? "block" : normalizeSwitch(sandbox.network, "allow"),
    file_read: normalizeSwitch(sandbox.file_read, "allow"),
    file_write: normalizeSwitch(sandbox.file_write, "allow"),
    secrets: normalizeSwitch(sandbox.secrets, "allow")
  };
}

export function evaluatePrivacySandboxToolPolicy({ config = {}, tool = {} } = {}) {
  const capabilities = capabilitiesOf(tool);
  if (config.offline_mode === true && capabilities.includes("network")) {
    return {
      allowed: false,
      reason: "offline_mode_blocks_network_tool",
      policy: normalizePrivacySandboxPolicy(config)
    };
  }

  const policy = normalizePrivacySandboxPolicy(config);
  if (policy.network === "block" && capabilities.includes("network")) {
    return {
      allowed: false,
      reason: "privacy_sandbox_blocks_network_tool",
      policy
    };
  }
  if (policy.file_read === "block" && capabilities.includes("file_read")) {
    return {
      allowed: false,
      reason: "privacy_sandbox_blocks_file_read_tool",
      policy
    };
  }
  if (policy.file_write === "block" && capabilities.includes("file_write")) {
    return {
      allowed: false,
      reason: "privacy_sandbox_blocks_file_write_tool",
      policy
    };
  }
  if (policy.secrets === "block" && capabilities.includes("secrets")) {
    return {
      allowed: false,
      reason: "privacy_sandbox_blocks_secret_tool",
      policy
    };
  }

  return {
    allowed: true,
    reason: null,
    policy
  };
}

export function buildPrivacySandboxSummary(config = {}) {
  const policy = normalizePrivacySandboxPolicy(config);
  return {
    ...policy,
    active: policy.mode !== "standard"
      || policy.network === "block"
      || policy.file_read === "block"
      || policy.file_write === "block"
      || policy.secrets === "block",
    blockedCapabilities: Object.entries(policy)
      .filter(([key, value]) => key !== "mode" && value === "block")
      .map(([key]) => key)
  };
}
