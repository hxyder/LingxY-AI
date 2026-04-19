import { createCapabilityMap } from "./types.mjs";

function normalizeScope(scope) {
  return String(scope ?? "").trim();
}

function hasScope(scopeSet, scope) {
  return scopeSet.has(scope);
}

function hasMicrosoftScope(scopeSet, permission) {
  if (scopeSet.has(permission)) return true;
  const lower = permission.toLowerCase();
  return [...scopeSet].some((scope) => scope.toLowerCase() === lower);
}

export function googleScopesToCapabilities(scopes = []) {
  const scopeSet = new Set(scopes.map(normalizeScope).filter(Boolean));
  return createCapabilityMap({
    emailRead:
      hasScope(scopeSet, "https://www.googleapis.com/auth/gmail.readonly")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/gmail.modify")
      || hasScope(scopeSet, "https://mail.google.com/"),
    emailWrite:
      hasScope(scopeSet, "https://www.googleapis.com/auth/gmail.send")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/gmail.compose")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/gmail.modify")
      || hasScope(scopeSet, "https://mail.google.com/"),
    fileRead:
      hasScope(scopeSet, "https://www.googleapis.com/auth/drive.readonly")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/drive.file")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/drive"),
    fileWrite:
      hasScope(scopeSet, "https://www.googleapis.com/auth/drive.file")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/drive"),
    calendarRead:
      hasScope(scopeSet, "https://www.googleapis.com/auth/calendar.readonly")
      || hasScope(scopeSet, "https://www.googleapis.com/auth/calendar"),
    calendarWrite: hasScope(scopeSet, "https://www.googleapis.com/auth/calendar")
  });
}

export function microsoftScopesToCapabilities(scopes = []) {
  const scopeSet = new Set(scopes.map(normalizeScope).filter(Boolean));
  return createCapabilityMap({
    emailRead: hasMicrosoftScope(scopeSet, "Mail.Read") || hasMicrosoftScope(scopeSet, "Mail.ReadWrite"),
    emailWrite: hasMicrosoftScope(scopeSet, "Mail.Send") || hasMicrosoftScope(scopeSet, "Mail.ReadWrite"),
    fileRead: hasMicrosoftScope(scopeSet, "Files.Read") || hasMicrosoftScope(scopeSet, "Files.ReadWrite"),
    fileWrite: hasMicrosoftScope(scopeSet, "Files.ReadWrite"),
    calendarRead: hasMicrosoftScope(scopeSet, "Calendars.Read") || hasMicrosoftScope(scopeSet, "Calendars.ReadWrite"),
    calendarWrite: hasMicrosoftScope(scopeSet, "Calendars.ReadWrite")
  });
}

export function scopesToCapabilities(provider, scopes = []) {
  if (provider === "google") return googleScopesToCapabilities(scopes);
  if (provider === "microsoft") return microsoftScopesToCapabilities(scopes);
  return createCapabilityMap();
}

