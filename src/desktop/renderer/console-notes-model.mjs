import {
  escapeHtml
} from "./shared-ui.mjs";

export function nowIso() {
  return new Date().toISOString();
}

export function formatNoteRelativeTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return sameYear ? `${mm}-${dd} ${hh}:${mi}` : `${date.getFullYear()}-${mm}-${dd}`;
}

export function formatNoteAbsoluteTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function makeNote() {
  const ts = nowIso();
  return {
    id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    body_html: "",
    group: "",
    created_at: ts,
    updated_at: ts,
    history: []
  };
}

export function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}

export function noteFilename(note, ext) {
  const base = (note.title || "note").replace(/[\\/:*?"<>|]/g, "_").trim() || "note";
  return `${base}.${ext}`;
}

export function stripInlineStamps(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  tmp.querySelectorAll(".note-stamp").forEach((element) => element.remove());
  return tmp.innerHTML;
}

export function exportAsText(note, opts) {
  const tmp = document.createElement("div");
  tmp.innerHTML = opts.keepInlineStamps ? note.body_html : stripInlineStamps(note.body_html);
  const body = (tmp.textContent || "").trim();
  const header = [];
  header.push(note.title || "Untitled note");
  if (opts.withTimestamps) {
    header.push(`Created: ${formatNoteAbsoluteTime(note.created_at)}`);
    header.push(`Last edited: ${formatNoteAbsoluteTime(note.updated_at)}`);
  }
  return `${header.join("\n")}\n\n${body}\n`;
}

export function exportAsMarkdown(note, opts) {
  const md = htmlToMarkdown(opts.keepInlineStamps ? note.body_html : stripInlineStamps(note.body_html));
  const header = [`# ${note.title || "Untitled note"}`];
  if (opts.withTimestamps) {
    header.push("");
    header.push(`> Created: ${formatNoteAbsoluteTime(note.created_at)}  `);
    header.push(`> Last edited: ${formatNoteAbsoluteTime(note.updated_at)}`);
  }
  return `${header.join("\n")}\n\n${md}\n`;
}

export function exportAsHtml(note, opts) {
  const body = opts.keepInlineStamps ? note.body_html : stripInlineStamps(note.body_html);
  const tsBlock = opts.withTimestamps
    ? `<p style="color:#94a3b8;font-size:12px;margin-top:0">Created: ${escapeHtml(formatNoteAbsoluteTime(note.created_at))} · Last edited: ${escapeHtml(formatNoteAbsoluteTime(note.updated_at))}</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(note.title || "Note")}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#0f172a;line-height:1.7}h1{font-size:22px}img{max-width:100%;border-radius:6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:6px 10px}.note-stamp{color:#94a3b8;font-family:ui-monospace,monospace;font-size:11.5px;padding:0 4px;background:rgba(0,0,0,.04);border-radius:3px}</style>
</head><body><h1>${escapeHtml(note.title || "Untitled note")}</h1>${tsBlock}${body}</body></html>`;
}

export function htmlToMarkdown(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(walk).join("");
    switch (tag) {
      case "h1": return `\n# ${inner}\n\n`;
      case "h2": return `\n## ${inner}\n\n`;
      case "h3": return `\n### ${inner}\n\n`;
      case "p":
      case "div": return `${inner}\n\n`;
      case "br": return "\n";
      case "strong":
      case "b": return `**${inner}**`;
      case "em":
      case "i": return `*${inner}*`;
      case "u": return inner;
      case "a": return `[${inner}](${node.getAttribute("href") || ""})`;
      case "img": {
        const src = node.getAttribute("src") || "";
        const alt = node.getAttribute("alt") || "";
        return `![${alt}](${src})`;
      }
      case "code": return `\`${inner}\``;
      case "blockquote": return inner.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
      case "hr": return `\n---\n\n`;
      case "li": {
        const parent = node.parentElement?.tagName?.toLowerCase();
        return parent === "ol" ? `1. ${inner}\n` : `- ${inner}\n`;
      }
      case "ul":
      case "ol": return `${inner}\n`;
      case "table": return tableToMd(node) + "\n";
      default: return inner;
    }
  };
  return Array.from(tmp.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
}

function tableToMd(table) {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";
  const render = (tr) => Array.from(tr.children)
    .map((cell) => (cell.textContent || "").trim().replace(/\|/g, "\\|"))
    .join(" | ");
  const head = render(rows[0]);
  const cols = rows[0].children.length;
  const sep = Array.from({ length: cols }, () => "---").join(" | ");
  const body = rows.slice(1).map(render).join("\n");
  return `| ${head} |\n| ${sep} |${body ? `\n| ${body.split("\n").map((row) => row + " |").join("\n| ")}` : ""}`;
}
