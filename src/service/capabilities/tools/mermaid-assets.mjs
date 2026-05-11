import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MERMAID_SPECIFIER = "mermaid/dist/mermaid.min.js";

function escapeHtmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function resolveMermaidScriptSrc({ resolver = import.meta.resolve } = {}) {
  if (typeof resolver === "function") {
    try {
      const resolved = resolver(MERMAID_SPECIFIER);
      if (typeof resolved === "string" && resolved.trim()) {
        return resolved;
      }
    } catch {
      // Fall through to the repo-local dependency path.
    }
  }
  return pathToFileURL(path.resolve(
    __dirname,
    "../../../../node_modules/mermaid/dist/mermaid.min.js"
  )).href;
}

export const MERMAID_SCRIPT_SRC = resolveMermaidScriptSrc();

export function renderMermaidScriptTag(src = MERMAID_SCRIPT_SRC) {
  return `<script src="${escapeHtmlAttr(src)}"></script>`;
}
