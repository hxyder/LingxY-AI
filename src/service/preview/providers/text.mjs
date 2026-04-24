// Text / code preview provider (UCA-182 Phase 2).
//
// Handles .txt / .log / .json and a small set of common source-code
// extensions by dumping the file into a styled <pre>. No syntax
// highlighting: keeps payloads tiny, defers any fancier rendering
// to a dedicated code-viewer provider if one is ever added.
//
// A soft size cap (~512 KB) keeps the preview responsive for huge
// log files; the truncation notice is visible to the user.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";

const TEXT_EXTENSIONS = [
  ".txt", ".log", ".json", ".jsonl", ".ndjson",
  ".js", ".mjs", ".cjs", ".jsx",
  ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".scala", ".swift",
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".m", ".mm",
  ".sh", ".bash", ".zsh", ".fish",
  ".ps1", ".bat", ".cmd",
  ".sql",
  ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".env",
  ".xml", ".xsl", ".xsd",
  ".css", ".scss", ".sass", ".less",
  ".vue", ".svelte",
  ".rst", ".tex",
  ".dockerfile"
];

const SOFT_LIMIT_BYTES = 512 * 1024;

export const TEXT_PROVIDER = {
  id: "text",
  extensions: TEXT_EXTENSIONS,
  mimePrefixes: ["text/plain", "application/json", "application/x-sh"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const raw = await readFile(ctx.filePath);
    const truncated = raw.length > SOFT_LIMIT_BYTES;
    const buf = truncated ? raw.subarray(0, SOFT_LIMIT_BYTES) : raw;
    const text = buf.toString("utf8");
    const parsed = path.parse(ctx.filePath);
    const banner = truncated
      ? `大文件预览已截断（前 ${Math.floor(SOFT_LIMIT_BYTES / 1024)} KB）。使用外部编辑器查看完整内容。`
      : null;
    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: parsed.base,
        mime: detectMime(ctx.ext),
        banner,
        bodyHtml: `<pre class="preview-pre">${escapeHtml(text)}</pre>`
      }),
      meta: { bytes: raw.length, truncated }
    };
  }
};

function detectMime(ext) {
  if (ext === ".json" || ext === ".jsonl" || ext === ".ndjson") return "json";
  if (ext === ".log" || ext === ".txt") return "text";
  return (ext || "text").replace(/^\./, "");
}
