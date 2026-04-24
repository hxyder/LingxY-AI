// Shared HTML shell for preview providers (UCA-182 Phase 2).
//
// Every HTML-producing provider assembles its content fragment, then
// calls buildHtmlShell() so the outer document structure, theme tokens
// and typography stay identical across formats. The shell matches the
// visual language of the existing sidecar previews (light-first, with
// dark-mode fallback via CSS vars so the parent app can switch themes).
//
// Keep this file dependency-free — it is imported by every provider,
// and must be inexpensive to load.

const BASE_STYLE = `
:root {
  color-scheme: light dark;
  --preview-bg: #f5f7fb;
  --preview-surface: #ffffff;
  --preview-border: #e2e8f0;
  --preview-text: #1e293b;
  --preview-muted: #64748b;
  --preview-accent: #2563eb;
  --preview-code-bg: #0f172a;
  --preview-code-fg: #e2e8f0;
  --preview-shadow: 0 16px 40px rgba(15, 23, 42, .08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --preview-bg: #0b1220;
    --preview-surface: #111a2e;
    --preview-border: #1f2a44;
    --preview-text: #e2e8f0;
    --preview-muted: #94a3b8;
    --preview-accent: #60a5fa;
    --preview-shadow: 0 16px 40px rgba(0, 0, 0, .35);
  }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--preview-bg);
  color: var(--preview-text);
  font: 14px/1.65 "Segoe UI", "PingFang SC", "Microsoft YaHei", Calibri, Arial, sans-serif;
}
article.preview-root {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px clamp(16px, 4vw, 36px);
}
article.preview-root > header {
  border-bottom: 1px solid var(--preview-border);
  padding-bottom: 12px;
  margin-bottom: 20px;
}
article.preview-root > header .preview-meta {
  color: var(--preview-muted);
  font-size: 11px;
  letter-spacing: .1em;
  text-transform: uppercase;
}
article.preview-root > header h1.preview-title {
  margin: 6px 0 0;
  font-size: 22px;
  font-weight: 600;
}
.preview-surface {
  background: var(--preview-surface);
  border: 1px solid var(--preview-border);
  border-radius: 10px;
  padding: 24px;
  box-shadow: var(--preview-shadow);
}
.preview-banner {
  background: #fef3c7;
  border: 1px solid #fbbf24;
  color: #78350f;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}
@media (prefers-color-scheme: dark) {
  .preview-banner { background: #422006; border-color: #92400e; color: #fde68a; }
}
pre.preview-pre {
  margin: 0;
  padding: 20px;
  background: var(--preview-code-bg);
  color: var(--preview-code-fg);
  border-radius: 8px;
  overflow: auto;
  font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
table.preview-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
table.preview-table th, table.preview-table td {
  border: 1px solid var(--preview-border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
table.preview-table thead th {
  background: rgba(37, 99, 235, .08);
  font-weight: 600;
}
table.preview-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
nav.preview-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
nav.preview-tabs button {
  background: var(--preview-surface);
  border: 1px solid var(--preview-border);
  color: var(--preview-text);
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
}
nav.preview-tabs button.active {
  background: var(--preview-accent);
  color: #fff;
  border-color: transparent;
}
.preview-content img { max-width: 100%; height: auto; }
.preview-content h1, .preview-content h2, .preview-content h3 { line-height: 1.3; }
.preview-content h1 { font-size: 26px; margin: 1.2em 0 .6em; }
.preview-content h2 { font-size: 20px; margin: 1.2em 0 .5em; }
.preview-content h3 { font-size: 17px; margin: 1em 0 .4em; }
.preview-content p { margin: .6em 0; }
.preview-content blockquote {
  border-left: 3px solid var(--preview-accent);
  margin: 1em 0;
  padding: .2em 1em;
  color: var(--preview-muted);
  background: rgba(37, 99, 235, .04);
}
.preview-content code {
  background: rgba(15, 23, 42, .08);
  padding: .1em .35em;
  border-radius: 4px;
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.preview-content pre code { background: transparent; padding: 0; color: inherit; }
`.trim();

/**
 * Escape user-supplied text for safe inclusion in HTML.
 * Duplicated with action_tools utilities on purpose — providers run in
 * the service process and must stay independent of renderer helpers.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}

/**
 * Build a full HTML document around a body fragment.
 *
 * @param {Object} opts
 * @param {string} opts.title         document <title>
 * @param {string} opts.bodyHtml      safe HTML fragment to embed inside .preview-root
 * @param {string} [opts.mime]        shown as uppercase meta label above the title
 * @param {string} [opts.subtitle]    optional subtitle shown under the title
 * @param {string} [opts.banner]      optional yellow banner rendered at the top
 * @param {string} [opts.extraHead]   additional <head> contents (stylesheets / scripts)
 * @param {string} [opts.lang]        html lang attribute (defaults to zh-CN)
 * @returns {string} full HTML document
 */
export function buildHtmlShell({
  title,
  bodyHtml,
  mime = "file",
  subtitle = null,
  banner = null,
  extraHead = "",
  lang = "zh-CN"
} = {}) {
  const safeTitle = escapeHtml(title || "Preview");
  const safeMime = escapeHtml(mime);
  const subtitleHtml = subtitle
    ? `<p class="preview-muted" style="color:var(--preview-muted);margin:4px 0 0;font-size:12px;">${escapeHtml(subtitle)}</p>`
    : "";
  const bannerHtml = banner
    ? `<div class="preview-banner" role="note">${escapeHtml(banner)}</div>`
    : "";
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BASE_STYLE}</style>
${extraHead}
</head>
<body>
<article class="preview-root">
  <header>
    <div class="preview-meta">${safeMime}</div>
    <h1 class="preview-title">${safeTitle}</h1>
    ${subtitleHtml}
  </header>
  ${bannerHtml}
  ${bodyHtml}
</article>
</body>
</html>`;
}
