const GOOGLE_CAPABILITY_SCOPES = Object.freeze({
  emailRead: ["https://www.googleapis.com/auth/gmail.readonly"],
  emailWrite: ["https://www.googleapis.com/auth/gmail.send"],
  fileRead: ["https://www.googleapis.com/auth/drive.readonly"],
  fileWrite: ["https://www.googleapis.com/auth/drive.file"],
  calendarRead: ["https://www.googleapis.com/auth/calendar.readonly"],
  calendarWrite: ["https://www.googleapis.com/auth/calendar.events"]
});

const MICROSOFT_CAPABILITY_SCOPES = Object.freeze({
  emailRead: ["Mail.Read"],
  emailWrite: ["Mail.Send"],
  fileRead: ["Files.Read.All"],
  fileWrite: ["Files.ReadWrite"],
  calendarRead: ["Calendars.Read"],
  calendarWrite: ["Calendars.ReadWrite"]
});

export function inferMissingScopes(provider, requiredCapability, currentScopes = []) {
  const candidates = provider === "google"
    ? GOOGLE_CAPABILITY_SCOPES[requiredCapability]
    : MICROSOFT_CAPABILITY_SCOPES[requiredCapability];
  if (!candidates) return [];
  const current = new Set(currentScopes);
  return candidates.filter((scope) => !current.has(scope));
}

export function buildReauthRequired(account, requiredCapability, message = null) {
  return {
    status: "reauth_required",
    provider: account.provider,
    accountId: account.id,
    missingCapabilities: [requiredCapability],
    missingScopes: inferMissingScopes(account.provider, requiredCapability, account.scopes ?? []),
    message: message ?? `当前账户缺少 ${requiredCapability} 能力，需要重新授权。`
  };
}

