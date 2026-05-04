import { escapeHtml } from "./shared-ui.mjs";

const FENCE_RE = /^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm;
const SVG_RE = /<svg\b[\s\S]*?<\/svg\s*>/gi;
const BLOCK_MARKER = "\u0000CHAT_BLOCK_";
const INLINE_MARKER = "\u0000CHAT_INLINE_";

export function renderChatMessageBlocks(target, source = "") {
  if (!target) return "";
  const text = String(source ?? "");
  const html = renderChatMessageBlocksHtml(text);
  target.dataset.rawText = text;
  target.innerHTML = html;
  return html;
}

export function renderChatMessageBlocksHtml(source = "") {
  const text = String(source ?? "");
  if (!text.trim()) return "";

  const blocks = [];
  let working = text.replace(FENCE_RE, (_match, lang, body) => {
    const index = blocks.length;
    blocks.push(renderFenceBlock(lang, body));
    return `${BLOCK_MARKER}${index}\u0000`;
  });

  working = working.replace(SVG_RE, (svg) => {
    const index = blocks.length;
    blocks.push(renderSvgBlock(svg));
    return `${BLOCK_MARKER}${index}\u0000`;
  });

  const html = renderTextBlocks(working);
  return html.replace(new RegExp(`${BLOCK_MARKER}(\\d+)\\u0000`, "g"), (_m, index) => {
    return blocks[Number(index)] ?? "";
  });
}

export function hasStructuredChatBlocks(source = "") {
  const text = String(source ?? "");
  return /(^|\n)#{1,4}\s+\S/.test(text)
    || /(^|\n)(?:[-*+]\s+|\d+\.\s+)/.test(text)
    || /(^|\n)```/.test(text)
    || /\n\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?/.test(text)
    || /<svg\b/i.test(text);
}

function renderFenceBlock(lang = "", body = "") {
  const label = String(lang ?? "").trim();
  const lower = label.toLowerCase();
  if (lower === "mermaid") {
    return `
      <div class="md-diagram md-diagram--mermaid">
        <div class="md-diagram-head">
          <span>Mermaid</span>
          <span>Diagram source</span>
        </div>
        <pre class="mermaid md-mermaid-source">${escapeHtml(String(body ?? "").trim())}</pre>
      </div>
    `;
  }
  const langAttr = label ? ` data-lang="${escapeHtml(label)}"` : "";
  const langPill = label ? `<span class="md-code-lang">${escapeHtml(label)}</span>` : "";
  return `
    <div class="md-code"${langAttr}>
      ${langPill}
      <pre><code>${escapeHtml(String(body ?? "").replace(/\n$/, ""))}</code></pre>
      <button type="button" class="md-code-copy" data-md-copy>复制</button>
    </div>
  `;
}

function renderSvgBlock(svg = "") {
  const safe = sanitizeSvgMarkup(svg);
  if (!safe) {
    return `<div class="md-svg-rejected">SVG block omitted: unsafe markup.</div>`;
  }
  return `<figure class="md-svg-figure">${safe}</figure>`;
}

export function sanitizeSvgMarkup(svg = "") {
  let safe = String(svg ?? "").trim();
  if (!/^<svg\b[\s\S]*<\/svg\s*>$/i.test(safe)) return "";
  safe = safe
    .replace(/<\s*(script|foreignObject|iframe|object|embed|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|foreignObject|iframe|object|embed|style)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src|xlink:href)\s*=\s*(["'])\s*(?:javascript|data):[^"']*\1/gi, " href=\"#blocked\"");
  if (!/^<svg\b/i.test(safe) || !/<\/svg\s*>$/i.test(safe)) return "";
  return safe;
}

function renderTextBlocks(source = "") {
  const lines = String(source ?? "").split(/\r?\n/);
  const out = [];
  let paragraph = [];
  let i = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }

    if (line.startsWith(BLOCK_MARKER)) {
      flushParagraph();
      out.push(line.trim());
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(4, heading[1].length);
      out.push(`<div class="md-h${level}">${renderInline(heading[2])}</div>`);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      flushParagraph();
      const table = collectTable(lines, i);
      out.push(renderTable(table.rows, table.alignments));
      i = table.nextIndex;
      continue;
    }

    if (/^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line)) {
      flushParagraph();
      const list = collectList(lines, i);
      out.push(renderList(list.items, list.ordered));
      i = list.nextIndex;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph();
  return out.join("\n");
}

function isTableStart(lines, index) {
  const current = String(lines[index] ?? "");
  const next = String(lines[index + 1] ?? "");
  return current.includes("|") && isTableDelimiter(next);
}

function isTableDelimiter(line = "") {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function collectTable(lines, index) {
  const header = splitTableRow(lines[index]);
  const delimiter = splitTableRow(lines[index + 1]);
  const alignments = delimiter.map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
  });
  const rows = [header];
  let cursor = index + 2;
  while (cursor < lines.length && String(lines[cursor] ?? "").includes("|") && String(lines[cursor] ?? "").trim()) {
    rows.push(splitTableRow(lines[cursor]));
    cursor += 1;
  }
  return { rows, alignments, nextIndex: cursor };
}

function splitTableRow(line = "") {
  const trimmed = String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderTable(rows = [], alignments = []) {
  if (!rows.length) return "";
  const [header, ...body] = rows;
  const th = header.map((cell, index) => renderTableCell("th", cell, alignments[index])).join("");
  const tr = body.map((row) => `<tr>${row.map((cell, index) => renderTableCell("td", cell, alignments[index])).join("")}</tr>`).join("");
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function renderTableCell(tag, value, alignment = "left") {
  const align = ["left", "center", "right"].includes(alignment) ? alignment : "left";
  return `<${tag} style="text-align:${align};">${renderInline(value)}</${tag}>`;
}

function collectList(lines, index) {
  const first = String(lines[index] ?? "");
  const ordered = /^\s*\d+\.\s+/.test(first);
  const items = [];
  let cursor = index;
  const re = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  while (cursor < lines.length) {
    const match = re.exec(String(lines[cursor] ?? ""));
    if (!match) break;
    items.push(match[1]);
    cursor += 1;
  }
  return { ordered, items, nextIndex: cursor };
}

function renderList(items = [], ordered = false) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag} class="md-list">${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
}

function renderInline(text = "") {
  const placeholders = [];
  const hold = (html) => {
    const index = placeholders.length;
    placeholders.push(html);
    return `${INLINE_MARKER}${index}\u0000`;
  };

  let working = String(text ?? "");
  working = working.replace(/`([^`]+)`/g, (_m, code) => hold(`<code class="md-inline-code">${escapeHtml(code)}</code>`));
  working = working.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_m, alt, url) => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) return escapeHtml(_m);
    return hold(`<a href="${escapeHtml(safeUrl)}" data-open-url="${escapeHtml(safeUrl)}" class="md-image-link"><img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(alt)}" class="md-image"></a>`);
  });
  working = working.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) return escapeHtml(_m);
    return hold(`<a href="${escapeHtml(safeUrl)}" data-open-url="${escapeHtml(safeUrl)}" class="md-link">${escapeHtml(label)}</a>`);
  });
  working = working.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<>"]+)/g, (_m, prefix, url) => {
    const { clean, trailing } = splitTrailingPunctuation(url);
    const safeUrl = sanitizeExternalUrl(clean);
    if (!safeUrl) return `${prefix}${escapeHtml(url)}`;
    return `${prefix}${hold(`<a href="${escapeHtml(safeUrl)}" data-open-url="${escapeHtml(safeUrl)}" class="md-link">${escapeHtml(clean)}</a>`)}${escapeHtml(trailing)}`;
  });

  working = escapeHtml(working)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  return working.replace(new RegExp(`${INLINE_MARKER}(\\d+)\\u0000`, "g"), (_m, index) => {
    return placeholders[Number(index)] ?? "";
  });
}

function sanitizeExternalUrl(url = "") {
  const value = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(value)) return "";
  return value;
}

function splitTrailingPunctuation(url = "") {
  const match = /^(.*?)([)\].,，。；;:：!?！？]+)?$/.exec(String(url ?? ""));
  return {
    clean: match?.[1] ?? String(url ?? ""),
    trailing: match?.[2] ?? ""
  };
}
