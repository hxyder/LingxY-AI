import { parseHTML } from "linkedom";

const TEXT_BLOCK_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dt",
  "figcaption",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "p",
  "section",
  "td",
  "th",
  "tr"
]);

const REMOVED_TEXT_TAGS = new Set([
  "head",
  "iframe",
  "noscript",
  "object",
  "script",
  "style",
  "template"
]);

const URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "formaction",
  "href",
  "poster",
  "src",
  "xlink:href"
]);

const BLOCKED_HTML_TAGS = new Set([
  "base",
  "embed",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
  "style",
  "template"
]);

function parseBodyFragment(html = "") {
  const { document } = parseHTML(`<!doctype html><html><body>${String(html ?? "")}</body></html>`);
  return document.body;
}

function normalizeHost(host = "") {
  return String(host ?? "").trim().toLowerCase().replace(/\.$/u, "");
}

export function hostnameMatches(hostname = "", expectedHost = "") {
  const host = normalizeHost(hostname);
  const expected = normalizeHost(expectedHost);
  return Boolean(expected && (host === expected || host.endsWith(`.${expected}`)));
}

export function urlHostnameMatches(rawUrl = "", expectedHost = "") {
  try {
    const value = String(rawUrl ?? "").trim();
    if (!/^(?:https?:)?\/\//iu.test(value)) return false;
    const parsed = new URL(value.startsWith("//") ? `https:${value}` : value);
    return hostnameMatches(parsed.hostname, expectedHost);
  } catch {
    return false;
  }
}

export function textMentionsHost(text = "", expectedHost = "") {
  const expected = normalizeHost(expectedHost);
  if (!expected) return false;
  const hostLike = /(?:^|[\s"'<>])([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d+)?(?:[/?#:]|$)/giu;
  let match;
  while ((match = hostLike.exec(String(text ?? ""))) !== null) {
    if (hostnameMatches(match[1], expected)) return true;
  }
  return false;
}

export function htmlMentionsHost(html = "", expectedHost = "") {
  const body = parseBodyFragment(html);
  for (const element of body.querySelectorAll("*")) {
    for (const attr of URL_ATTRIBUTE_NAMES) {
      const value = element.getAttribute(attr);
      if (value && urlHostnameMatches(value, expectedHost)) return true;
    }
  }
  return textMentionsHost(body.textContent ?? "", expectedHost);
}

export function decodeHtmlEntities(text = "") {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|nbsp|quot|#39|apos|lt|gt|amp);/giu, (_match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) return safeCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith("#")) return safeCodePoint(Number.parseInt(normalized.slice(1), 10));
    return {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"'
    }[normalized] ?? "";
  });
}

function safeCodePoint(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return "";
  try { return String.fromCodePoint(value); } catch { return ""; }
}

function textContentWithBreaks(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const tag = String(node.localName ?? node.nodeName ?? "").toLowerCase();
  if (REMOVED_TEXT_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  const childText = Array.from(node.childNodes ?? []).map(textContentWithBreaks).join("");
  return TEXT_BLOCK_TAGS.has(tag) ? `\n${childText}\n` : childText;
}

export function htmlToPlainText(html = "", { maxLength = Infinity } = {}) {
  const body = parseBodyFragment(html);
  const text = textContentWithBreaks(body)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return Number.isFinite(maxLength) && text.length > maxLength
    ? text.slice(0, Math.max(0, maxLength))
    : text;
}

export function sanitizeHtmlFragment(html = "") {
  const body = parseBodyFragment(html);
  sanitizeDescendants(body);
  return body.innerHTML;
}

function sanitizeDescendants(root) {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = String(element.localName ?? element.nodeName ?? "").toLowerCase();
    if (BLOCKED_HTML_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    for (const attr of Array.from(element.attributes ?? [])) {
      const name = String(attr.name ?? "").toLowerCase();
      const value = String(attr.value ?? "");
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRIBUTE_NAMES.has(name) && hasDangerousUrlScheme(value)) {
        element.setAttribute(attr.name, "#blocked");
      }
      if (name === "srcset" && hasDangerousUrlScheme(value)) {
        element.removeAttribute(attr.name);
      }
    }
  }
}

function hasDangerousUrlScheme(value = "") {
  const compact = String(value ?? "").trim().replace(/[\u0000-\u001f\u007f\s]+/gu, "").toLowerCase();
  return compact.startsWith("javascript:") || compact.startsWith("data:") || compact.startsWith("vbscript:");
}
