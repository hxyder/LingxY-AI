function normalizeWildcardPattern(pattern) {
  return pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
}

function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => {
    if (!pattern) {
      return false;
    }
    if (pattern.startsWith("(?i)")) {
      return new RegExp(pattern.slice(4), "i").test(value);
    }
    if (pattern.includes("*")) {
      return new RegExp(`^${normalizeWildcardPattern(pattern)}$`, "i").test(value);
    }
    return value.toLowerCase() === pattern.toLowerCase();
  });
}

export function evaluateBlocklist(contextPacket, securityConfig) {
  const processName = contextPacket.source_app ?? "";
  const windowTitle = `${contextPacket.selection_metadata?.window_title ?? ""}`;
  const url = `${contextPacket.url ?? ""}`;
  const hostname = (() => {
    try {
      return url ? new URL(url).hostname : "";
    } catch {
      return "";
    }
  })();

  if (matchesAnyPattern(processName, securityConfig.blocklist?.process_names)) {
    return {
      blocked: true,
      reason: "process_blocked"
    };
  }

  if (matchesAnyPattern(windowTitle, securityConfig.blocklist?.window_title_patterns)) {
    return {
      blocked: true,
      reason: "window_title_blocked"
    };
  }

  if (hostname && matchesAnyPattern(hostname, securityConfig.blocklist?.url_domains)) {
    return {
      blocked: true,
      reason: "domain_blocked"
    };
  }

  if (securityConfig.allowlist?.enable_only) {
    const allowedProcess = matchesAnyPattern(processName, securityConfig.allowlist?.process_names);
    const allowedDomain = hostname ? matchesAnyPattern(hostname, securityConfig.allowlist?.url_domains) : true;
    if (!allowedProcess && !allowedDomain) {
      return {
        blocked: true,
        reason: "not_in_allowlist"
      };
    }
  }

  return {
    blocked: false,
    reason: null
  };
}
