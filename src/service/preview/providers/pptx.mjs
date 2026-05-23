// PPTX preview provider.
//
// Generated artifacts already ship with a sidecar HTML preview and are
// picked up by the higher-priority sidecar provider. This module is the
// fallback for arbitrary existing `.pptx` files: it parses slide
// coordinates from OOXML and renders a browser-native preview with no
// external office dependency.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildHtmlShell, escapeHtml } from "../preview-shell.mjs";

export const PPTX_PROVIDER = {
  id: "pptx",
  extensions: [".pptx"],
  mimePrefixes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  priority: 10,
  version: "3",
  async render(ctx) {
    return renderCoordinatePreview(ctx);
  }
};

const EMU_PER_PX = 9525;
const DEFAULT_SLIDE_W_EMU = 9144000;  // 10in at 914400 EMU/in
const DEFAULT_SLIDE_H_EMU = 6858000;  // 7.5in (4:3); widescreen overrides

async function renderCoordinatePreview(ctx) {
  try {
    const JSZipMod = await import("jszip");
    const JSZip = JSZipMod.default ?? JSZipMod;
    const { parseHTML } = await import("linkedom");
    const bytes = await readFile(ctx.filePath);
    const zip = await JSZip.loadAsync(bytes);

    const slideSize = await readSlideSize(zip, parseHTML);
    const slideWPx = Math.round(slideSize.wEmu / EMU_PER_PX);
    const slideHPx = Math.round(slideSize.hEmu / EMU_PER_PX);

    const slideEntries = collectSlideEntries(zip);
    const mediaMap = await loadMediaMap(zip);
    const slides = [];
    for (const entry of slideEntries) {
      const xml = await zip.file(entry.path).async("string");
      const relsXml = entry.relsPath ? await zip.file(entry.relsPath).async("string").catch(() => "") : "";
      const parsed = parseSlideCoords(xml, relsXml, mediaMap, parseHTML);
      slides.push({ index: entry.index, ...parsed });
    }

    const body = `<section class="preview-surface preview-content" style="background:var(--preview-bg);">
${slides.map((s) => renderSlideHtml(s, slideWPx, slideHPx)).join("\n")}
</section>`;

    return {
      kind: "html",
      cacheable: true,
      html: buildHtmlShell({
        title: path.basename(ctx.filePath),
        mime: "pptx",
        subtitle: `${slides.length} 张幻灯片 · ${slideWPx}×${slideHPx}`,
        extraHead: PPTX_SLIDE_CSS,
        bodyHtml: body
      }),
      meta: { slideCount: slides.length, via: "jszip-coords", slideWPx, slideHPx }
    };
  } catch (error) {
    return {
      kind: "native-open",
      cacheable: false,
      meta: { error: error.message }
    };
  }
}

async function readSlideSize(zip, parseHTML) {
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string").catch(() => "");
  if (!presentationXml) return { wEmu: DEFAULT_SLIDE_W_EMU, hEmu: DEFAULT_SLIDE_H_EMU };
  const m = /<p:sldSz\s+[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentationXml);
  if (!m) return { wEmu: DEFAULT_SLIDE_W_EMU, hEmu: DEFAULT_SLIDE_H_EMU };
  return { wEmu: Number(m[1]), hEmu: Number(m[2]) };
}

function renderSlideHtml(slide, widthPx, heightPx) {
  const shapes = slide.shapes.map((shape) => {
    const style = [
      `position:absolute`,
      `left:${shape.x}px`,
      `top:${shape.y}px`,
      `width:${shape.w}px`,
      `height:${shape.h}px`
    ];
    if (shape.kind === "text") {
      if (shape.placeholder === "title" || shape.placeholder === "ctrTitle") {
        style.push("display:flex", "align-items:center");
      }
      const text = shape.paragraphs.map((p) => renderParagraphHtml(p, shape.placeholder)).join("");
      return `<div class="pptx-shape pptx-text" style="${style.join(";")}">${text}</div>`;
    }
    if (shape.kind === "image") {
      return `<img class="pptx-shape pptx-image" src="${escapeHtml(shape.src)}" alt="" style="${style.join(";")};object-fit:contain;">`;
    }
    return "";
  }).join("");
  return `<div class="pptx-slide-wrap">
  <div class="pptx-slide-index">幻灯片 ${slide.index}</div>
  <div class="pptx-slide" style="width:${widthPx}px;height:${heightPx}px;">${shapes}</div>
</div>`;
}

function renderParagraphHtml(paragraph, placeholder) {
  const align = paragraph.align || (placeholder === "title" || placeholder === "ctrTitle" ? "center" : "left");
  const runs = paragraph.runs.map((run) => {
    const s = [];
    if (run.sizePt) s.push(`font-size:${run.sizePt}pt`);
    if (run.bold) s.push("font-weight:700");
    if (run.italic) s.push("font-style:italic");
    if (run.color) s.push(`color:${run.color}`);
    const content = escapeHtml(run.text).replace(/\n/g, "<br>");
    return s.length ? `<span style="${s.join(";")}">${content}</span>` : content;
  }).join("");
  const pStyle = `margin:0;text-align:${align};line-height:1.2;`;
  const bullet = paragraph.bullet ? `<span style="display:inline-block;width:1em;margin-right:4px;color:#666;">•</span>` : "";
  return `<p style="${pStyle}">${bullet}${runs}</p>`;
}

function parseSlideCoords(xml, relsXml, mediaMap, parseHTML) {
  const { document } = parseHTML(xml);
  const relMap = new Map();
  if (relsXml) {
    const { document: relsDoc } = parseHTML(relsXml);
    relsDoc.querySelectorAll("Relationship").forEach((rel) => {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) relMap.set(id, target);
    });
  }

  const shapes = [];
  // Text shapes: <p:sp> with <p:txBody>
  document.querySelectorAll("sp, p\\:sp").forEach((sp) => {
    const box = extractShapeBox(sp);
    if (!box) return;
    const placeholder = sp.querySelector("ph, p\\:ph")?.getAttribute("type") ?? null;
    const paragraphs = [];
    sp.querySelectorAll("txBody p, p\\:txBody a\\:p").forEach((p) => {
      const alignAttr = p.querySelector("pPr, a\\:pPr")?.getAttribute("algn");
      const align = alignAttr === "ctr" ? "center" : alignAttr === "r" ? "right" : alignAttr === "just" ? "justify" : "left";
      const bullet = Boolean(p.querySelector("pPr buChar, a\\:pPr a\\:buChar, pPr buAutoNum, a\\:pPr a\\:buAutoNum"));
      const runs = [];
      p.querySelectorAll("r, a\\:r").forEach((r) => {
        const rPr = r.querySelector("rPr, a\\:rPr");
        const szAttr = rPr?.getAttribute("sz");
        const sizePt = szAttr ? Number(szAttr) / 100 : null;
        const bold = rPr?.getAttribute("b") === "1";
        const italic = rPr?.getAttribute("i") === "1";
        const colorHex = rPr?.querySelector("solidFill srgbClr, a\\:solidFill a\\:srgbClr")?.getAttribute("val") ?? null;
        const color = colorHex ? `#${colorHex}` : null;
        const text = String(r.querySelector("t, a\\:t")?.textContent ?? "");
        if (text) runs.push({ text, sizePt, bold, italic, color });
      });
      if (runs.length) paragraphs.push({ runs, align, bullet });
    });
    if (paragraphs.length === 0) return;
    shapes.push({
      kind: "text",
      placeholder,
      x: box.x, y: box.y, w: box.w, h: box.h,
      paragraphs
    });
  });

  // Image shapes: <p:pic>
  document.querySelectorAll("pic, p\\:pic").forEach((pic) => {
    const box = extractShapeBox(pic);
    if (!box) return;
    const embedId = pic.querySelector("blip, a\\:blip")?.getAttribute("r:embed")
                 || pic.querySelector("blip, a\\:blip")?.getAttribute("embed");
    if (!embedId) return;
    const target = relMap.get(embedId);
    if (!target) return;
    const normalized = path.posix.normalize(path.posix.join("ppt/slides/", target)).replace(/^(?:\.\.\/)+/, "");
    const src = mediaMap.get(normalized);
    if (!src) return;
    shapes.push({ kind: "image", x: box.x, y: box.y, w: box.w, h: box.h, src });
  });

  return { shapes };
}

function extractShapeBox(node) {
  const xfrm = node.querySelector("spPr xfrm, p\\:spPr a\\:xfrm");
  if (!xfrm) return null;
  const off = xfrm.querySelector("off, a\\:off");
  const ext = xfrm.querySelector("ext, a\\:ext");
  if (!off || !ext) return null;
  const x = Math.round(Number(off.getAttribute("x") || 0) / EMU_PER_PX);
  const y = Math.round(Number(off.getAttribute("y") || 0) / EMU_PER_PX);
  const w = Math.round(Number(ext.getAttribute("cx") || 0) / EMU_PER_PX);
  const h = Math.round(Number(ext.getAttribute("cy") || 0) / EMU_PER_PX);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

const PPTX_SLIDE_CSS = `<style>
.pptx-slide-wrap {
  margin: 0 auto 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pptx-slide-index {
  align-self: flex-start;
  font-size: 11px;
  color: var(--preview-muted);
  letter-spacing: .06em;
  text-transform: uppercase;
  margin: 8px 0 4px;
}
.pptx-slide {
  position: relative;
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
  border: 1px solid #e2e8f0;
  overflow: hidden;
  font-family: "Calibri", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #1f2937;
  transform-origin: top left;
}
@media (max-width: 1020px) {
  .pptx-slide { transform: scale(0.75); }
  .pptx-slide-wrap { margin-bottom: -120px; }
}
.pptx-shape { box-sizing: border-box; }
.pptx-text {
  padding: 4px;
  font-size: 18pt;
  line-height: 1.2;
  overflow: hidden;
}
.pptx-text p { margin: 0; }
.pptx-image { display: block; }
</style>`;

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

// Phase 10c obsoletes the old parseSlide/looksLikeTitle helpers —
// coordinate layout lives in parseSlideCoords above.
