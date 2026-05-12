import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import {
  OUTLINE_KINDS,
  KIND_EXTENSIONS,
  KIND_MIMES,
  buildPdfHtml,
  escapeHtml,
  invokeDocumentRenderer,
  normalizeDocumentOutline,
  prepareGeneratedDocumentCheckpoint,
  previewSidecarPathForArtifact,
  writeDocumentPreviewSidecar,
  writePdfFromHtmlArtifact
} from "./document-artifact-helpers.mjs";
import { renderMermaidScriptTag } from "./mermaid-assets.mjs";
import { sanitizeSvgMarkup } from "./svg-sanitize.mjs";
import { resolveOutputDirForTool, ensureOutputDir, resolveSandboxedTarget } from "../../core/artifact-path-helper.mjs";

export const GENERATE_DOCUMENT_TOOL = {
  id: "generate_document",
  name: "Generate Document",
  description: `Produce a professionally styled pptx / docx / xlsx / pdf / html artifact from a structured outline.

Outline shapes:
• pptx → { title, subtitle?, author?, date?, slides: [{ heading, bullets?: string[], body?: string, table?: { headers: string[], rows: any[][] }, layout?: "section" }] }
• docx/pdf/html → { title, subtitle?, author?, date?, sections: [{ heading, level?: 1|2, body?: string, bullets?: string[], table?: { headers: string[], rows: any[][] }, diagram?: { code, caption? }, svg?: { markup, caption? } }] }
• xlsx → { headers: string[], rows: any[][] }  OR  { sheets: [{ name, headers, rows }] }

Preferred calling convention:
• Pass \`outline\` as a native object, not a stringified JSON string.
• The tool will still normalize stringified JSON or plain-text outlines as a fallback, but object input is more reliable across models.

For reports with charts: include Mermaid diagram code in body text wrapped in triple-backtick mermaid blocks or as \`diagram\` components. SVG components are sanitized before rendering. HTML output is a first-class artifact, not a fallback.`,
  parameters: ACTION_TOOL_SCHEMAS.generate_document,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase().trim();
    if (!OUTLINE_KINDS.has(kind)) {
      return createActionResult({
        success: false,
        observation: `generate_document rejected: kind must be one of pptx/docx/xlsx/pdf/html. Got "${args.kind}".`,
        metadata: { tool_id: "generate_document" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const targetArg = typeof args.path === "string" && args.path.trim()
        ? args.path.trim()
        : (typeof args.filename === "string" && args.filename.trim()
          ? args.filename.trim()
          : `result${KIND_EXTENSIONS[kind]}`);
      const absTarget = await resolveSandboxedTarget(outputDir, targetArg);
      const outline = normalizeDocumentOutline(kind, args.outline ?? {});
      const primaryReversibility = await prepareGeneratedDocumentCheckpoint(
        ctx,
        absTarget,
        `generate_document_${kind}`
      );

      if (kind === "html") {
        const htmlContent = buildPdfHtml(outline);
        await writeFile(absTarget, htmlContent, "utf8");
        return createActionResult({
          success: true,
          observation: `generate_document produced HTML at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
          metadata: {
            tool_id: "generate_document",
            kind,
            path: absTarget,
            mime_type: KIND_MIMES[kind],
            preview_html_path: absTarget,
            reversibility: primaryReversibility
          },
          artifactPaths: [absTarget]
        });
      }

      if (kind === "pdf") {
        const htmlPath = absTarget.replace(/\.pdf$/i, ".html");
        const htmlContent = buildPdfHtml(outline);
        const htmlSourceReversibility = await prepareGeneratedDocumentCheckpoint(
          ctx,
          htmlPath,
          "generate_document_pdf_html_source"
        );
        await writeFile(htmlPath, htmlContent, "utf8");
        try {
          await writePdfFromHtmlArtifact(htmlPath, absTarget);
          const previewTarget = previewSidecarPathForArtifact(absTarget);
          const previewReversibility = await prepareGeneratedDocumentCheckpoint(
            ctx,
            previewTarget,
            "generate_document_preview_sidecar"
          );
          const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
          return createActionResult({
            success: true,
            observation: `generate_document produced PDF at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
            metadata: {
              tool_id: "generate_document", kind,
              path: absTarget, mime_type: KIND_MIMES[kind],
              html_source_path: htmlPath,
              preview_html_path: previewPath,
              reversibility: primaryReversibility,
              reversibility_sidecars: [htmlSourceReversibility, previewReversibility]
            },
            artifactPaths: [absTarget]
          });
        } catch (error) {
          return createActionResult({
            success: true,
            observation: `generate_document could not convert to PDF (${error.message}); produced HTML at ${path.relative(outputDir, htmlPath)}.`,
            metadata: {
              tool_id: "generate_document", kind,
              path: htmlPath, mime_type: "text/html",
              preview_html_path: htmlPath,
              needs_pdf_conversion: true, pdf_conversion_error: error.message,
              reversibility: htmlSourceReversibility
            },
            artifactPaths: [htmlPath]
          });
        }
      }

      await invokeDocumentRenderer({ kind, targetPath: absTarget, outline });
      const previewTarget = previewSidecarPathForArtifact(absTarget);
      const previewReversibility = await prepareGeneratedDocumentCheckpoint(
        ctx,
        previewTarget,
        "generate_document_preview_sidecar"
      );
      const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
      return createActionResult({
        success: true,
        observation: `generate_document produced ${kind.toUpperCase()} at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
        metadata: {
          tool_id: "generate_document",
          kind,
          path: absTarget,
          mime_type: KIND_MIMES[kind],
          preview_html_path: previewPath,
          reversibility: primaryReversibility,
          reversibility_sidecars: [previewReversibility]
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `generate_document failed: ${error.message}`,
        metadata: { tool_id: "generate_document", kind }
      });
    }
  }
};

export const RENDER_DIAGRAM_TOOL = {
  id: "render_diagram",
  name: "Render Diagram",
  description: `Render a Mermaid diagram to a standalone interactive HTML file.
Use for any chart or diagram in reports: flowchart, sequenceDiagram, pie, xychart-beta (bar/line), gantt, mindmap, timeline, etc.
The output HTML can be opened in any browser or embedded in a PDF via generate_document.

Example code:
  pie title Browser Share
    "Chrome" : 65
    "Firefox" : 20
    "Other" : 15`,
  parameters: ACTION_TOOL_SCHEMAS.render_diagram,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const code = String(args.code ?? "").trim();
    const filename = typeof args.filename === "string" && args.filename.trim()
      ? args.filename.trim().replace(/\.(html|svg|png)$/i, "") + ".html"
      : "diagram.html";
    if (!code) {
      return createActionResult({
        success: false,
        observation: "render_diagram: no Mermaid code provided.",
        metadata: { tool_id: "render_diagram" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const htmlPath = await resolveSandboxedTarget(outputDir, filename);
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagram</title>
${renderMermaidScriptTag()}
<style>
  body { margin: 0; padding: 24px; background: #fff; font-family: system-ui, sans-serif; }
  .mermaid { max-width: 100%; }
  pre.mermaid-fallback {
    background: #F1F5F9; border: 1px solid #E2E8F0;
    padding: 12px; border-radius: 4px; white-space: pre-wrap; color: #475569;
  }
</style>
</head>
<body>
<div class="mermaid">
${escapeHtml(code)}
</div>
<script>
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
  } else {
    document.querySelectorAll(".mermaid").forEach(el => {
      const pre = document.createElement("pre");
      pre.className = "mermaid-fallback";
      pre.textContent = el.textContent;
      el.replaceWith(pre);
    });
  }
</script>
</body>
</html>`;
      await writeFile(htmlPath, html, "utf8");
      return createActionResult({
        success: true,
        observation: `render_diagram produced ${path.relative(outputDir, htmlPath) || path.basename(htmlPath)}`,
        metadata: { tool_id: "render_diagram", path: htmlPath, mime_type: "text/html" },
        artifactPaths: [htmlPath]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `render_diagram failed: ${error.message}`,
        metadata: { tool_id: "render_diagram" }
      });
    }
  }
};

export const RENDER_SVG_TOOL = {
  id: "render_svg",
  name: "Render SVG",
  description: "Write sanitized standalone SVG markup to a task artifact. Use for vector illustrations, icon-like diagrams, simple charts, layout mockups, or other scalable visual components.",
  parameters: ACTION_TOOL_SCHEMAS.render_svg,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const svg = sanitizeSvgMarkup(args.svg ?? args.markup ?? args.source ?? "");
    const filename = typeof args.filename === "string" && args.filename.trim()
      ? args.filename.trim().replace(/\.(html|svg|png)$/i, "") + ".svg"
      : "graphic.svg";
    if (!svg) {
      return createActionResult({
        success: false,
        observation: "render_svg: valid <svg> markup required.",
        metadata: { tool_id: "render_svg" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const svgPath = await resolveSandboxedTarget(outputDir, filename);
      await writeFile(svgPath, svg, "utf8");
      return createActionResult({
        success: true,
        observation: `render_svg produced ${path.relative(outputDir, svgPath) || path.basename(svgPath)}`,
        metadata: { tool_id: "render_svg", path: svgPath, mime_type: "image/svg+xml" },
        artifactPaths: [svgPath]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `render_svg failed: ${error.message}`,
        metadata: { tool_id: "render_svg" }
      });
    }
  }
};
