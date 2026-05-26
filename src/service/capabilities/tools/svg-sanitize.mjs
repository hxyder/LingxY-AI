import { parseHTML } from "linkedom";

const FORBIDDEN_SVG_TAGS = new Set([
  "embed",
  "foreignobject",
  "iframe",
  "object",
  "script",
  "style"
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href"]);

export function sanitizeSvgMarkup(markup = "") {
  const raw = String(markup ?? "").trim();
  if (!raw) return "";
  const { document } = parseHTML(`<!doctype html><html><body>${raw}</body></html>`);
  const roots = Array.from(document.body.children ?? []);
  if (roots.length !== 1) return "";
  const root = roots[0];
  if (String(root.localName ?? root.nodeName ?? "").toLowerCase() !== "svg") return "";

  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = String(element.localName ?? element.nodeName ?? "").toLowerCase();
    if (FORBIDDEN_SVG_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    sanitizeSvgAttributes(element);
  }
  sanitizeSvgAttributes(root);
  return root.outerHTML.trim();
}

export function isSafeSvgMarkup(markup = "") {
  return sanitizeSvgMarkup(markup).length > 0;
}

function sanitizeSvgAttributes(element) {
  for (const attr of Array.from(element.attributes ?? [])) {
    const name = String(attr.name ?? "").toLowerCase();
    const value = String(attr.value ?? "");
    if (name.startsWith("on") || name === "xmlns:xlink") {
      element.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.has(name) && hasDangerousUrlScheme(value)) {
      element.setAttribute(attr.name, "#blocked");
    }
  }
}

function hasDangerousUrlScheme(value = "") {
  const compact = String(value ?? "").trim().replace(/[\u0000-\u001f\u007f\s]+/gu, "").toLowerCase();
  return compact.startsWith("javascript:") || compact.startsWith("data:") || compact.startsWith("vbscript:");
}
