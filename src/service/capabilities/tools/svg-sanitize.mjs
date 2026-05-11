const FORBIDDEN_ELEMENT_RE = /<\s*(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SELF_CLOSING_FORBIDDEN_RE = /<\s*(script|foreignObject|iframe|object|embed)\b[^>]*\/\s*>/gi;
const EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi;
const JAVASCRIPT_URL_RE = /\s+(href|xlink:href)\s*=\s*("|\')\s*javascript:[\s\S]*?\2/gi;
const XML_DECL_RE = /^\s*<\?xml[\s\S]*?\?>\s*/i;
const DOCTYPE_RE = /^\s*<!doctype[\s\S]*?>\s*/i;

export function sanitizeSvgMarkup(markup = "") {
  const raw = String(markup ?? "").trim();
  if (!raw) return "";
  const withoutPreamble = raw
    .replace(XML_DECL_RE, "")
    .replace(DOCTYPE_RE, "")
    .trim();
  if (!/^<svg[\s>]/i.test(withoutPreamble) || !/<\/svg>\s*$/i.test(withoutPreamble)) {
    return "";
  }
  return withoutPreamble
    .replace(FORBIDDEN_ELEMENT_RE, "")
    .replace(SELF_CLOSING_FORBIDDEN_RE, "")
    .replace(EVENT_HANDLER_RE, "")
    .replace(JAVASCRIPT_URL_RE, "")
    .replace(/\s+xmlns:xlink\s*=\s*(".*?"|'.*?')/gi, "")
    .trim();
}

export function isSafeSvgMarkup(markup = "") {
  return sanitizeSvgMarkup(markup).length > 0;
}
