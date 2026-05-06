// Streaming-phase preview (UCA-182 Phase 3).
//
// During a previewable artifact tool call the model streams its tool
// arguments as partial JSON. We render whatever is already complete,
// without pretending we know the final layout:
//
//   write_file (.md/.html/.txt/.json/.code/...) → stream the `content`
//     field value verbatim into a <pre> (for code) or let marked paint
//     markdown source. Safe because the content IS the file.
//
//   generate_document → the args describe sections / slides / rows as
//     structured data. We extract only the *title* and top-level
//     *heading* text fields and render them as a markdown outline
//     (`# Title\n## Heading`). No tables, no bullets, no "slide cards".
//     Banner is explicit: "大纲预览 · 正在生成".
//
//   render_diagram / render_svg → stream the source while the final
//     HTML/SVG artifact is being written, then let the final preview
//     provider render the actual file.
//
// This file intentionally does not simulate docx / pptx / xlsx
// layouts — we never try to reconstruct tables, bullet lists, or
// slide cards from the partial JSON.

(function initPreviewStreaming() {
  const helpers = window.livePreviewClient?._helpers ?? {
    escapeHtml: (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]))
  };
  const { escapeHtml } = helpers;

  const STREAM_DEBOUNCE_MS = 150;
  const MAX_RENDER_BYTES = 256 * 1024;
  const pendingRenders = new WeakMap(); // container → timeout

  function scheduleRender(container, fn) {
    const existing = pendingRenders.get(container);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      pendingRenders.delete(container);
      try { fn(); } catch (e) { /* best-effort streaming paint */ }
    }, STREAM_DEBOUNCE_MS);
    pendingRenders.set(container, t);
  }

  function renderDelta(container, { toolName, rawJson, toolKind, toolPath }) {
    if (!container) return;
    if (toolName === "generate_document") {
      scheduleRender(container, () => renderOutline(container, rawJson, toolPath));
      return;
    }
    if (toolName === "render_diagram") {
      scheduleRender(container, () => renderDiagramStream(container, rawJson));
      return;
    }
    if (toolName === "render_svg") {
      scheduleRender(container, () => renderSvgStream(container, rawJson));
      return;
    }
    scheduleRender(container, () => renderContentStream(container, rawJson, toolKind, toolPath));
  }

  // ── write_file / edit_file — stream the content field -----------------
  function renderContentStream(container, rawJson, toolKind, toolPath) {
    const content = extractStringField(rawJson, "content") || "";
    if (!content) {
      container.innerHTML = `<div class="lp-prejson"><pre></pre></div>`;
      const pre = container.querySelector("pre");
      if (pre) pre.textContent = String(rawJson || "").slice(-2000);
      return;
    }
    const truncated = content.length > MAX_RENDER_BYTES ? content.slice(0, MAX_RENDER_BYTES) : content;
    if (toolKind === "markdown") {
      renderMarkdownInto(container, truncated);
      return;
    }
    if (toolKind === "html") {
      let iframe = container.querySelector("iframe.lp-iframe");
      if (!iframe) {
        container.innerHTML = `<iframe class="lp-iframe" sandbox="allow-same-origin"></iframe>`;
        iframe = container.querySelector("iframe");
      }
      iframe.srcdoc = truncated;
      return;
    }
    // text / json / code → <pre>
    let pre = container.querySelector("pre.lp-pre");
    if (!pre) {
      container.innerHTML = `<pre class="lp-pre"></pre>`;
      pre = container.querySelector("pre");
    }
    pre.textContent = truncated;
    pre.scrollTop = pre.scrollHeight;
  }

  // ── generate_document — outline-only (no fake layout) -----------------
  function renderOutline(container, rawJson, toolPath) {
    const title = extractStringField(rawJson, "title");
    const subtitle = extractStringField(rawJson, "subtitle");
    const headings = collectHeadings(rawJson);
    const md = buildOutlineMarkdown({ title, subtitle, headings, toolPath });
    container.innerHTML = `
      <div class="lp-banner" style="margin:0 0 10px;padding:8px 12px;background:#fef3c7;border:1px solid #fbbf24;color:#78350f;border-radius:6px;font-size:12px;">
        大纲预览 · 正在生成 · 完成后加载真实预览
      </div>
      <div class="lp-outline"></div>`;
    const target = container.querySelector(".lp-outline");
    renderMarkdownInto(target, md);
  }

  function renderDiagramStream(container, rawJson) {
    const code = extractStringField(rawJson, "code")
      || extractStringField(rawJson, "mermaid")
      || extractStringField(rawJson, "source");
    const shown = code || String(rawJson || "").slice(-2000);
    container.innerHTML = `
      <div class="lp-banner">
        图表预览 · 正在生成 · 完成后加载可交互 HTML
      </div>
      <pre class="lp-pre"></pre>`;
    const pre = container.querySelector("pre");
    if (pre) pre.textContent = shown;
  }

  function renderSvgStream(container, rawJson) {
    const svg = extractStringField(rawJson, "svg")
      || extractStringField(rawJson, "markup")
      || extractStringField(rawJson, "source");
    if (!svg) {
      container.innerHTML = `<div class="lp-prejson"><pre></pre></div>`;
      const pre = container.querySelector("pre");
      if (pre) pre.textContent = String(rawJson || "").slice(-2000);
      return;
    }
    let iframe = container.querySelector("iframe.lp-iframe");
    if (!iframe) {
      container.innerHTML = `<iframe class="lp-iframe" sandbox></iframe>`;
      iframe = container.querySelector("iframe");
    }
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#fff;}svg{max-width:96vw;max-height:96vh;}</style></head><body>${svg}</body></html>`;
  }

  function buildOutlineMarkdown({ title, subtitle, headings, toolPath }) {
    const parts = [];
    if (title) parts.push(`# ${title}`);
    else if (toolPath) parts.push(`# ${basename(toolPath)}`);
    if (subtitle) parts.push(`*${subtitle}*`);
    parts.push("");
    headings.forEach((h, i) => {
      if (h.kind === "slide") parts.push(`## 幻灯片 ${i + 1}${h.text ? " · " + h.text : ""}`);
      else if (h.kind === "section") parts.push(`## ${h.text || "(未命名章节)"}`);
      else if (h.kind === "sheet") parts.push(`## 工作表：${h.text || "(未命名)"}`);
      else if (h.kind === "row") parts.push(`- ${h.text}`);
      else parts.push(`## ${h.text}`);
    });
    return parts.join("\n");
  }

  function collectHeadings(rawJson) {
    const out = [];
    // Scan for slides[].heading
    const slides = extractTopLevelArrayField(rawJson, "slides");
    if (slides) {
      iterateObjectStrings(slides, "heading", (text) => out.push({ kind: "slide", text }));
      return out;
    }
    const sections = extractTopLevelArrayField(rawJson, "sections");
    if (sections) {
      iterateObjectStrings(sections, "heading", (text) => out.push({ kind: "section", text }));
      return out;
    }
    const sheets = extractTopLevelArrayField(rawJson, "sheets");
    if (sheets) {
      iterateObjectStrings(sheets, "name", (text) => out.push({ kind: "sheet", text }));
      return out;
    }
    return out;
  }

  // ── minimal markdown renderer (headings + bold/italic/code/lists) -----
  function renderMarkdownInto(container, source) {
    // Keep this tiny: we are *not* re-parsing docx / pptx, just
    // showing outline/stream text. marked is unavailable in the
    // renderer (no bundler); implement the essentials ourselves.
    const html = markdownToHtml(source || "");
    container.innerHTML = `<div class="lp-md">${html}</div>`;
  }

  function markdownToHtml(src) {
    const lines = String(src).split("\n");
    const out = [];
    let inList = false;
    let paragraph = [];
    const flushParagraph = () => {
      if (paragraph.length) {
        out.push(`<p>${inline(paragraph.join(" "))}</p>`);
        paragraph = [];
      }
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (!line) {
        if (inList) { out.push("</ul>"); inList = false; }
        flushParagraph();
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        if (inList) { out.push("</ul>"); inList = false; }
        flushParagraph();
        const level = h[1].length;
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        flushParagraph();
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
        continue;
      }
      if (inList) { out.push("</ul>"); inList = false; }
      paragraph.push(line);
    }
    if (inList) out.push("</ul>");
    flushParagraph();
    return out.join("\n");
  }

  function inline(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  }

  // ── partial-JSON helpers ----------------------------------------------
  // Exported as livePreviewStreaming.extractStringField because
  // live-preview.js still needs it to detect the streaming `path`
  // field before the value is known.
  function extractStringField(partial, fieldName) {
    if (!partial) return "";
    const re = new RegExp(`"${fieldName}"\\s*:\\s*"`);
    const match = re.exec(partial);
    if (!match) return "";
    let i = match.index + match[0].length;
    let out = "";
    let escape = false;
    while (i < partial.length) {
      const ch = partial[i];
      if (escape) {
        if (ch === "n") out += "\n";
        else if (ch === "t") out += "\t";
        else if (ch === "r") out += "\r";
        else out += ch;
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        return out;
      } else {
        out += ch;
      }
      i += 1;
    }
    return out;
  }

  /**
   * Return the raw text slice after `"<fieldName>":` opener, or null.
   * Unlike the removed layout-faking helpers, we only use this to
   * find where arrays start — we never try to reconstruct complex
   * shapes. The outline walker only cares about string fields.
   */
  function extractTopLevelArrayField(partial, fieldName) {
    if (!partial) return null;
    const re = new RegExp(`"${fieldName}"\\s*:\\s*\\[`);
    const match = re.exec(partial);
    if (!match) return null;
    return partial.slice(match.index + match[0].length);
  }

  /**
   * Walk a partial JSON array slice (`{...}, {...}, {...}`), pulling
   * `fieldName` from each inner object if it's a complete string.
   */
  function iterateObjectStrings(arraySlice, fieldName, visit) {
    const reField = new RegExp(`"${fieldName}"\\s*:\\s*"`);
    let text = arraySlice;
    while (true) {
      const m = reField.exec(text);
      if (!m) break;
      let i = m.index + m[0].length;
      let out = "";
      let escape = false;
      let terminated = false;
      while (i < text.length) {
        const ch = text[i];
        if (escape) { out += ch; escape = false; }
        else if (ch === "\\") escape = true;
        else if (ch === "\"") { terminated = true; break; }
        else out += ch;
        i += 1;
      }
      if (!terminated) break;
      visit(out);
      text = text.slice(i + 1);
    }
  }

  function basename(p) {
    return (p || "").split(/[\\/]/).pop() || p;
  }

  window.livePreviewStreaming = {
    renderDelta,
    renderMarkdownInto,
    extractStringField,
    _internal: { buildOutlineMarkdown, markdownToHtml, collectHeadings }
  };
})();
