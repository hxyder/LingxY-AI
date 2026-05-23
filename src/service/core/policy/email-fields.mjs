export const EMAIL_LIKE_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function unique(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function extractEmailAddresses(value = "") {
  return unique(String(value ?? "").match(EMAIL_LIKE_REGEX) ?? []);
}

function splitEmailString(value = "") {
  const text = String(value ?? "");
  const emails = extractEmailAddresses(text);
  if (emails.length > 0) return emails;
  return text.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean);
}

export function normalizeEmailAddressList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return unique(value.flatMap((item) => splitEmailString(item)));
  }
  if (typeof value === "string") return splitEmailString(value);
  return unique([String(value)]);
}

export function normalizeEmailFieldInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const normalized = { ...input };
  for (const key of ["to", "cc", "bcc", "attendees"]) {
    if (normalized[key] !== undefined) {
      normalized[key] = normalizeEmailAddressList(normalized[key]);
    }
  }
  return normalized;
}
