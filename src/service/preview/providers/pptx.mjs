// PPTX preview provider (UCA-182 Phase 5).
//
// Two tiers:
//
//   Tier 1 — LibreOffice (pixel-perfect):
//     When `soffice` is on PATH (detected at startup and cached on
//     runtime.capabilities.libreoffice), run
//       soffice --headless --convert-to pdf --outdir <tmp> <file.pptx>
//     Cache the resulting PDF as a sibling `<name>-preview.pdf`, then
//     return a pdf-redirect envelope so the renderer shows the real
//     slide layout.
//
//   Tier 2 — jszip text structure (no soffice):
//     Read ppt/slides/slide*.xml via jszip, parse the XML with linkedom,
//     pull every <a:t> text node and every <p:pic> image reference, and
//     render one card per slide in document order. A prominent yellow
//     banner tells the user this is a text/structure view, not the real
//     layout, and offers a link back to the install flow. The design
//     rule from the task spec: "宁可无法预览也不要假渲染" — the banner
//     is what makes this renderer honest.
//
// The provider always refuses to cache Tier 2 output against a file's
// mtime — the sidecar pdf (Tier 1) uses the generic registry cache
// keyed off provider version, which is enough.

import { readFile, writeFile, stat, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";

const execFileP = promisify(execFile);
const SOFFICE_TIMEOUT_MS = 45000;

export const PPTX_PROVIDER = {
  id: "pptx",
  extensions: [".pptx"],
  mimePrefixes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  priority: 10,
  version: "1",
  async render(ctx) {
    const capability = ctx.runtime?.capabilities?.libreoffice;
    if (capability?.present) {
      try {
        const pdfPath = await convertPptxToPdf(ctx.filePath, capability);
        return {
          kind: "pdf-redirect",
          pdfPath,
          cacheable: false,
          meta: { tier: 1, via: "libreoffice" }
        };
      } catch (error) {
        // Fall through to tier 2 if soffice invocation fails.
        return renderTier2(ctx, { warning: `LibreOffice 渲染失败（${error.message}），已回退到文本结构预览。` });
      }
    }
    return renderTier2(ctx, { warning: null });
  }
};

async function convertPptxToPdf(filePath, capability) {
  const parsed = path.parse(filePath);
  const sidecar = path.join(parsed.dir, `${parsed.name}-preview.pdf`);
  // Reuse cached sidecar if it's newer than the source pptx.
  try {
    const [src, cached] = await Promise.all([stat(filePath), stat(sidecar)]);
    if (cached.mtimeMs >= src.mtimeMs) return sidecar;
  } catch { /* cached sidecar missing — generate */ }

  const outDir = await mkdtemp(path.join(tmpdir(), "lingxy-pptx-"));
  try {
    await execFileP(
      capability.path || capability.command || "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", outDir, filePath],
      { timeout: SOFFICE_TIMEOUT_MS }
    );
    const generated = path.join(outDir, `${parsed.name}.pdf`);
    // Copy to sidecar location so subsequent opens skip the soffice spawn.
    const pdfBytes = await readFile(generated);
    await writeFile(sidecar, pdfBytes);
    return sidecar;
  } finally {
    rm(outDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
}

// --- Tier 2: jszip + linkedom text structure ---------------------------

async function renderTier2(ctx, { warning }) {
  try {
    const JSZipMod = await import("jszip");
    const JSZip = JSZipMod.default ?? JSZipMod;
    const { parseHTML } = await import("linkedom");
    const bytes = await readFile(ctx.filePath);
    const zip = await JSZip.loadAsync(bytes);

    const slideEntries = collectSlideEntries(zip);
    const mediaMap = await loadMediaMap(zip);
    const slides = [];
    for (const entry of slideEntries) {
      const xml = await zip.file(entry.path).async("string");
      const relsXml = entry.relsPath ? await zip.file(entry.relsPath).async("string").catch(() => "") : "";
      const parsed = parseSlide(xml, relsXml, mediaMap, parseHTML);
      slides.push({ index: entry.index, ...parsed });
    }

    const banner = warning
      ? warning
      : "⚠️ 文本结构预览 · 原始布局请用 PowerPoint 或安装 LibreOffice 查看";

    const body = `<section class="preview-surface preview-content">
${slides.map((s) => `<article class="preview-pptx-slide" style="border:1px solid var(--preview-border);border-radius:10px;padding:18px;margin-bottom:12px;background:var(--preview-surface);">
  <header style="color:var(--preview-muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">幻灯片 ${s.index}</header>
  ${s.title ? `<h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(s.title)}</h2>` : ""}
  ${s.paragraphs.length ? `<ul style="padding-left:20px;margin:0;">${s.paragraphs.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
  ${s.images.map((src) => `<img src="${escapeHtml(src)}" alt="" style="max-width:100%;margin-top:10px;border-radius:6px;">`).join("")}
</article>`).join("\n")}
</section>`;

    return {
      kind: "html",
      cacheable: false,
      html: buildHtmlShell({
        title: path.basename(ctx.filePath),
        mime: "pptx",
        banner,
        bodyHtml: body
      }),
      meta: { tier: 2, slideCount: slides.length, via: "jszip" }
    };
  } catch (error) {
    return {
      kind: "native-open",
      cacheable: false,
      meta: { tier: 2, error: error.message }
    };
  }
}

function collectSlideEntries(zip) {
  const entries = [];
  zip.forEach((relPath) => {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(relPath);
    if (match) {
      entries.push({
        path: relPath,
        relsPath: `ppt/slides/_rels/slide${match[1]}.xml.rels`,
        index: Number(match[1])
      });
    }
  });
  entries.sort((a, b) => a.index - b.index);
  return entries;
}

async function loadMediaMap(zip) {
  // Preload embedded media as data URLs so the HTML can reference them
  // without shipping the zip to the client.
  const map = new Map();
  const tasks = [];
  zip.forEach((relPath, file) => {
    if (!/^ppt\/media\//i.test(relPath) || file.dir) return;
    tasks.push(file.async("nodebuffer").then((buf) => {
      const ext = path.extname(relPath).slice(1).toLowerCase();
      const mime = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
        svg: "image/svg+xml"
      }[ext] ?? "application/octet-stream";
      map.set(path.posix.normalize(relPath), `data:${mime};base64,${buf.toString("base64")}`);
    }));
  });
  await Promise.all(tasks);
  return map;
}

function parseSlide(xml, relsXml, mediaMap, parseHTML) {
  // linkedom's XML mode is good enough for <a:t> text extraction;
  // PPTX namespaces are preserved as local prefixes.
  const { document } = parseHTML(xml);
  const textNodes = document.querySelectorAll("a\\:t, t");
  const paragraphs = [];
  let title = "";
  textNodes.forEach((node) => {
    const text = String(node.textContent ?? "").trim();
    if (!text) return;
    if (!title && looksLikeTitle(node)) title = text;
    else paragraphs.push(text);
  });

  // Map rels → media paths. Images appear as <p:blipFill><a:blip r:embed="rId3"/>.
  const relMap = new Map();
  if (relsXml) {
    const { document: relsDoc } = parseHTML(relsXml);
    relsDoc.querySelectorAll("Relationship").forEach((rel) => {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) relMap.set(id, target);
    });
  }
  const images = [];
  document.querySelectorAll("blip, a\\:blip").forEach((blip) => {
    const embedId = blip.getAttribute("r:embed") || blip.getAttribute("embed");
    if (!embedId) return;
    const relTarget = relMap.get(embedId);
    if (!relTarget) return;
    // slideXml.rels Target is relative to ppt/slides/; resolve up.
    const normalized = path.posix.normalize(path.posix.join("ppt/slides/", relTarget)).replace(/^(?:\.\.\/)+/, "");
    if (mediaMap.has(normalized)) images.push(mediaMap.get(normalized));
  });

  return { title, paragraphs, images };
}

function looksLikeTitle(node) {
  // Walk up; slide title placeholders have <p:nvSpPr><p:nvPr><p:ph type="title|ctrTitle"/>.
  let el = node;
  for (let i = 0; i < 10 && el; i += 1) {
    if (el.localName === "sp" || el.nodeName === "p:sp") {
      const ph = el.querySelector("ph, p\\:ph");
      const type = ph?.getAttribute("type") || "";
      return type === "title" || type === "ctrTitle";
    }
    el = el.parentNode;
  }
  return false;
}
