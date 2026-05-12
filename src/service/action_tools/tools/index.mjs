import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ACTION_TOOL_SCHEMAS } from "../../capabilities/schemas/index.mjs";
import { createActionResult } from "../../capabilities/registry/types.mjs";
import { CONNECTOR_ACTION_TOOLS } from "../../capabilities/connectors/tools/action-tool-aggregator.mjs";
import { MEMORY_TOOLS } from "../../capabilities/tools/memory-tools.mjs";
import { TRANSLATE_TEXT_TOOL, WEB_SEARCH_FETCH_TOOL, FETCH_URL_CONTENT_TOOL, OPEN_URL_TOOL, WEB_SEARCH_TOOL } from "../../capabilities/tools/browser-web-tools.mjs";
import { OPEN_FILE_TOOL, REVEAL_IN_EXPLORER_TOOL, FILE_OP_TOOL, COPY_TO_CLIPBOARD_TOOL, READ_CLIPBOARD_TOOL, NOTIFY_TOOL } from "../../capabilities/tools/os-app-tools.mjs";
import { COMPOSE_EMAIL_TOOL, SEND_EMAIL_SMTP_TOOL } from "../../capabilities/tools/email-tools.mjs";
import { CREATE_SCHEDULED_TASK_TOOL, LIST_SCHEDULED_TASKS_TOOL, DELETE_SCHEDULED_TASK_TOOL, PAUSE_SCHEDULED_TASK_TOOL } from "../../capabilities/tools/scheduler-tools.mjs";
import { STAT_FILE_TOOL, VERIFY_FILE_EXISTS_TOOL, LIST_FILES_TOOL, GLOB_FILES_TOOL, FIND_RECENT_FILES_TOOL, GET_LATEST_ARTIFACT_TOOL } from "../../capabilities/tools/file-read-tools.mjs";
import { VISION_ANALYZE_TOOL } from "../../capabilities/tools/vision-analyze.mjs";
import { TAKE_SCREENSHOT_TOOL, GUI_FIND_ELEMENT_TOOL, GUI_CLICK_TOOL, GUI_TYPE_TEXT_TOOL } from "../../capabilities/tools/desktop-capture-gui-tools.mjs";
import { LAUNCH_APP_TOOL } from "../../capabilities/tools/desktop-launch-tools.mjs";
import { READ_FILE_TEXT_TOOL, READ_FOLDER_TEXT_TOOL, SEARCH_FILE_CONTENT_TOOL, INDEX_FILE_CONTENT_TOOL, REGISTER_ARTIFACT_TOOL, RESOLVE_OUTPUT_PATH_TOOL } from "../../capabilities/tools/file-content-tools.mjs";
import { WRITE_FILE_TOOL, EDIT_FILE_TOOL, RUN_SCRIPT_TOOL } from "../../capabilities/tools/file-mutation-execution-tools.mjs";
import {
  OUTLINE_KINDS,
  KIND_EXTENSIONS,
  KIND_MIMES,
  artifactKindFromTarget,
  buildPdfHtml,
  escapeHtml,
  invokeDocumentRenderer,
  normalizeDocumentOutline,
  prepareGeneratedDocumentCheckpoint,
  previewSidecarPathForArtifact,
  writeDocumentPreviewSidecar,
  writePdfFromHtmlArtifact
} from "../../capabilities/tools/document-artifact-helpers.mjs";
import { renderMermaidScriptTag } from "../../capabilities/tools/mermaid-assets.mjs";
import { sanitizeSvgMarkup } from "../../capabilities/tools/svg-sanitize.mjs";
import { resolveOutputDirForTool, ensureOutputDir, resolveSandboxedTarget } from "../../core/artifact-path-helper.mjs";
import {
  applyCapabilityInterviewAnswer,
  buildCapabilityDraft,
  buildCapabilityInterviewState,
  buildCapabilityRecoveryProposal,
  discardCapabilityInterviewState,
  validateCapabilityDraft
} from "../../core/capability-creator/index.mjs";
import { resolveMcpDraftsDir } from "../../capabilities/mcp/drafts.mjs";
import { createEditableSkill, slugifySkillId } from "../../capabilities/skills/lifecycle.mjs";
import {
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL
} from "../../capabilities/tools/skill-install-tools.mjs";

export {
  createLaunchAmbiguityResult,
  normalizeLaunchCandidates
} from "../../capabilities/tools/desktop-launch-tools.mjs";

export {
  EDIT_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  WRITE_FILE_TOOL
};

/* ------------------------------------------------------------------------ */
/* UCA-049 commit 2: universal tool belt                                     */
/*                                                                           */
/*   - write_file:        sandbox-checked file writing                       */
/*   - run_script:        whitelisted language execution with timeout        */
/*   - generate_document: pptx / docx / xlsx / pdf / html via render-document */
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
      const outline   = normalizeDocumentOutline(kind, args.outline ?? {});
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

/* ------------------------------------------------------------------------ */
/* PDF HTML builder (with Mermaid support)                                   */
/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
/* RENDER_DIAGRAM_TOOL — Mermaid diagrams to standalone HTML                 */
/* ------------------------------------------------------------------------ */

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
    const code     = String(args.code ?? "").trim();
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
      const htmlPath  = await resolveSandboxedTarget(outputDir, filename);
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

/* ------------------------------------------------------------------------ */
/* RENDER_SVG_TOOL — sanitized standalone vector graphics                    */
/* ------------------------------------------------------------------------ */

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

// UCA-077: draft-only capability interview tool. It only calls pure creator
// functions and returns interview state, an in-memory draft, or recovery.
function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rehydrateInterviewState(rawState) {
  if (!isPlainObject(rawState)) return null;
  const kind = typeof rawState.kind === "string" ? rawState.kind : "";
  if (kind !== "skill" && kind !== "mcp") return null;
  let state = buildCapabilityInterviewState({ kind, name: rawState.name ?? "" });
  const collected = isPlainObject(rawState.collected) ? rawState.collected : {};
  if (typeof collected.purpose === "string") {
    state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: collected.purpose });
  }
  if (collected.permissions !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "permissions", value: collected.permissions });
  }
  if (collected.config !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "config", value: collected.config });
  }
  if (collected.confirmed === true) {
    state = applyCapabilityInterviewAnswer(state, { field: "confirmation", value: true });
  }
  return state;
}

function buildOneShotInterviewState(args) {
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (kind !== "skill" && kind !== "mcp") {
    return { error: "draft_capability requires kind=\"skill\" or kind=\"mcp\"." };
  }
  let state;
  try {
    state = buildCapabilityInterviewState({ kind, name: args.name ?? "" });
  } catch (error) {
    return { error: error.message };
  }
  if (typeof args.purpose === "string") {
    state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: args.purpose });
  }
  if (args.permissions !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "permissions", value: args.permissions });
  }
  if (args.config !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "config", value: args.config });
  }
  if (args.confirmation === true) {
    state = applyCapabilityInterviewAnswer(state, { field: "confirmation", value: true });
  }
  return { state };
}

function summarizeDraftForObservation(draft) {
  const lines = [
    `Draft is ready to save (kind=${draft.kind}, id=${draft.id}, name="${draft.name}").`,
    `purpose: ${draft.purpose}`
  ];
  const permissions = draft.permissions ?? {};
  lines.push(
    `permissions: network=${permissions.network ? "true" : "false"}, filesystem=${permissions.filesystem ?? "none"}, secrets=${(permissions.secrets ?? []).length}`
  );
  if (draft.kind === "skill") {
    const instructions = draft.entry?.markdown?.split("\n").filter((l) => l.startsWith("- ")) ?? [];
    lines.push(`skill: ${instructions.length} instruction step(s); SKILL.md prepared in-memory only.`);
  } else if (draft.kind === "mcp") {
    const desc = draft.descriptor ?? {};
    if (desc.transport === "stdio") {
      lines.push(`mcp: transport=stdio command=${desc.command ?? ""}`);
    } else {
      lines.push(`mcp: transport=${desc.transport ?? "?"} url=${desc.url ?? ""}`);
    }
    lines.push(`mcp: enabled=false (draft only; not installed).`);
  }
  return lines.join("\n");
}

function summarizeInterviewForObservation(state) {
  const next = state.next_question;
  const lines = [
    `Capability interview is incomplete (kind=${state.kind}, missing: ${state.missing_fields.join(", ")}).`
  ];
  if (next) {
    lines.push(`Next question (${next.id}): ${next.prompt}`);
    if (next.hint) lines.push(`Hint: ${next.hint}`);
  }
  return lines.join("\n");
}

function summarizeRecoveryForObservation(proposal) {
  const lines = [proposal.question];
  if (Array.isArray(proposal.suggested_next_actions)) {
    for (const action of proposal.suggested_next_actions) {
      lines.push(`- ${action.field}: ${action.prompt}`);
    }
  }
  return lines.join("\n");
}

function summarizeDiscardForObservation(state) {
  const name = state?.name ? ` "${state.name}"` : "";
  return `Capability draft${name} was discarded. No files, MCP config, or secrets were changed.`;
}

export const DRAFT_CAPABILITY_TOOL = {
  id: "draft_capability",
  name: "Draft Capability",
  description: "Draft a skill or MCP capability through an interview. Read-only: never installs, writes files, edits runtime config, or stores secrets. Use {state, answer} to continue, {state, discard:true} to discard, or one-shot kind/name/purpose/permissions/config/confirmation. Secret values must be env or secret_ref references.",
  parameters: ACTION_TOOL_SCHEMAS.draft_capability,
  risk_level: "low",
  requires_confirmation: false,
  async execute(args = {}) {
    let state = null;

    if (isPlainObject(args.state)) {
      state = rehydrateInterviewState(args.state);
      if (!state) {
        return createActionResult({
          success: false,
          observation: "draft_capability could not rehydrate the provided state. Re-send {kind, name, purpose, permissions, config, confirmation} or call again with a valid state.",
          error: "capability_state_invalid",
          metadata: { tool_id: "draft_capability", status: "invalid_state" }
        });
      }
      if (args.discard === true || (isPlainObject(args.answer) && args.answer.field === "discard" && args.answer.value !== false)) {
        const discarded = discardCapabilityInterviewState(state);
        return createActionResult({
          success: true,
          observation: summarizeDiscardForObservation(discarded),
          metadata: {
            tool_id: "draft_capability",
            status: "discarded",
            state: discarded
          }
        });
      }
      if (isPlainObject(args.answer)) {
        try {
          state = applyCapabilityInterviewAnswer(state, args.answer);
        } catch (error) {
          const recovery = buildCapabilityRecoveryProposal(error);
          return createActionResult({
            success: false,
            observation: summarizeRecoveryForObservation(recovery),
            error: error.message,
            metadata: {
              tool_id: "draft_capability",
              status: "recovery_required",
              recovery
            }
          });
        }
      }
    } else {
      const built = buildOneShotInterviewState(args);
      if (built.error) {
        return createActionResult({
          success: false,
          observation: built.error,
          error: built.error,
          metadata: { tool_id: "draft_capability", status: "invalid_input" }
        });
      }
      state = built.state;
      if (isPlainObject(args.answer)) {
        try {
          state = applyCapabilityInterviewAnswer(state, args.answer);
        } catch (error) {
          const recovery = buildCapabilityRecoveryProposal(error);
          return createActionResult({
            success: false,
            observation: summarizeRecoveryForObservation(recovery),
            error: error.message,
            metadata: {
              tool_id: "draft_capability",
              status: "recovery_required",
              recovery
            }
          });
        }
      }
    }

    if (state.status !== "ready_to_save") {
      return createActionResult({
        success: true,
        observation: summarizeInterviewForObservation(state),
        metadata: {
          tool_id: "draft_capability",
          status: "interviewing",
          state,
          missing_fields: state.missing_fields,
          next_question: state.next_question
        }
      });
    }

    const draft = buildCapabilityDraft(state);
    const validation = validateCapabilityDraft(draft);
    if (!validation.ok) {
      const recovery = buildCapabilityRecoveryProposal(validation);
      return createActionResult({
        success: false,
        observation: summarizeRecoveryForObservation(recovery),
        error: "capability_draft_invalid",
        metadata: {
          tool_id: "draft_capability",
          status: "recovery_required",
          state,
          draft,
          validation,
          recovery
        }
      });
    }

    return createActionResult({
      success: true,
      observation: summarizeDraftForObservation(draft),
      metadata: {
        tool_id: "draft_capability",
        status: "ready_to_save",
        state,
        draft,
        validation
      }
    });
  }
};

// UCA-077: persist a capability draft. High-risk + confirmation-required.
// Skill drafts go through createEditableSkill (runtime-bound path safety);
// MCP drafts are written as a JSON file under a runtime-local drafts dir.
// The tool never installs an MCP server, never mutates runtime config, and
// never persists literal secret values; descriptor.enabled is always false
// and env values must already be ${env:NAME} / ${secret_ref:NAME} refs.

async function saveCapabilityDraftSkill(runtime, draft) {
  const created = await createEditableSkill(runtime, {
    id: draft.id,
    name: draft.name,
    description: draft.purpose,
    markdown: draft.entry?.markdown ?? ""
  });
  return {
    kind: "skill",
    id: created.id,
    path: created.entryPath,
    validation: created.validation
  };
}

async function saveCapabilityDraftMcp(runtime, draft) {
  const draftsDir = resolveMcpDraftsDir(runtime);
  await mkdir(draftsDir, { recursive: true });
  const safeId = slugifySkillId(draft.id || draft.name || "mcp-draft");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeId}-${stamp}.json`;
  const targetPath = path.join(draftsDir, filename);
  // Defensively force enabled=false; descriptor.env was already validated as
  // reference-only by validateCapabilityDraft.
  const descriptor = { ...(draft.descriptor ?? {}), enabled: false };
  const payload = {
    kind: "mcp",
    status: "draft",
    id: draft.id,
    name: draft.name,
    purpose: draft.purpose,
    permissions: draft.permissions,
    secrets: draft.secrets,
    descriptor,
    saved_at: new Date().toISOString()
  };
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    kind: "mcp",
    id: draft.id,
    path: targetPath
  };
}

export const SAVE_CAPABILITY_DRAFT_TOOL = {
  id: "save_capability_draft",
  name: "Save Capability Draft",
  description: "Persist a capability draft from draft_capability. Skill drafts write SKILL.md under the runtime skills root. MCP drafts write a disabled JSON draft and never edit live runtime config. High-risk: requires user confirmation.",
  parameters: ACTION_TOOL_SCHEMAS.save_capability_draft,
  risk_level: "high",
  required_capabilities: ["file_write"],
  requires_confirmation: true,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx?.runtime ?? null;
    if (!runtime || !isPlainObject(runtime?.paths)) {
      return createActionResult({
        success: false,
        observation: "save_capability_draft requires a runtime with configured paths.",
        error: "runtime_unavailable",
        metadata: { tool_id: "save_capability_draft", status: "runtime_unavailable" }
      });
    }

    let draft = isPlainObject(args.draft) ? args.draft : null;
    if (!draft && isPlainObject(args.state)) {
      try {
        draft = buildCapabilityDraft(args.state);
      } catch (error) {
        return createActionResult({
          success: false,
          observation: `save_capability_draft could not rebuild a draft from the provided state: ${error.message}`,
          error: error.message,
          metadata: { tool_id: "save_capability_draft", status: "invalid_state" }
        });
      }
    }
    if (!draft) {
      return createActionResult({
        success: false,
        observation: "save_capability_draft requires a draft (from draft_capability) or a completed interview state.",
        error: "draft_missing",
        metadata: { tool_id: "save_capability_draft", status: "draft_missing" }
      });
    }

    const validation = validateCapabilityDraft(draft);
    if (!validation.ok) {
      const recovery = buildCapabilityRecoveryProposal(validation);
      return createActionResult({
        success: false,
        observation: summarizeRecoveryForObservation(recovery),
        error: "capability_draft_invalid",
        metadata: {
          tool_id: "save_capability_draft",
          status: "recovery_required",
          validation,
          recovery
        }
      });
    }

    try {
      if (draft.kind === "skill" && typeof runtime.paths.skillsDir !== "string") {
        return createActionResult({
          success: false,
          observation: "save_capability_draft cannot save a skill because runtime.paths.skillsDir is not configured.",
          error: "skillsDir_not_configured",
          metadata: { tool_id: "save_capability_draft", status: "runtime_unavailable", kind: "skill" }
        });
      }
      if (draft.kind === "mcp" && !resolveMcpDraftsDir(runtime)) {
        return createActionResult({
          success: false,
          observation: "save_capability_draft cannot save an MCP draft because runtime.paths.baseDir or runtime.paths.mcpDraftsDir is not configured.",
          error: "mcp_drafts_dir_not_configured",
          metadata: { tool_id: "save_capability_draft", status: "runtime_unavailable", kind: "mcp" }
        });
      }
      const saved = draft.kind === "skill"
        ? await saveCapabilityDraftSkill(runtime, draft)
        : await saveCapabilityDraftMcp(runtime, draft);
      const observation = saved.kind === "skill"
        ? `Saved editable skill "${draft.name}" to ${saved.path}. Review or test it before relying on it.`
        : `Saved MCP draft "${draft.name}" to ${saved.path}. The server stays disabled and is not registered until reviewed.`;
      return createActionResult({
        success: true,
        observation,
        artifactPaths: [saved.path],
        metadata: {
          tool_id: "save_capability_draft",
          status: "saved",
          kind: saved.kind,
          id: saved.id,
          path: saved.path,
          enabled: saved.kind === "mcp" ? false : null,
          validation: saved.validation ?? null,
          review_required: true
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `save_capability_draft failed to persist draft: ${error.message}`,
        error: error.message,
        metadata: { tool_id: "save_capability_draft", status: "save_failed" }
      });
    }
  }
};

export const BUILTIN_ACTION_TOOLS = Object.freeze([
  OPEN_URL_TOOL,
  WEB_SEARCH_TOOL,
  COMPOSE_EMAIL_TOOL,
  SEND_EMAIL_SMTP_TOOL,
  OPEN_FILE_TOOL,
  REVEAL_IN_EXPLORER_TOOL,
  LAUNCH_APP_TOOL,
  COPY_TO_CLIPBOARD_TOOL,
  NOTIFY_TOOL,
  FILE_OP_TOOL,
  TAKE_SCREENSHOT_TOOL,
  READ_CLIPBOARD_TOOL,
  CREATE_SCHEDULED_TASK_TOOL,
  LIST_SCHEDULED_TASKS_TOOL,
  DELETE_SCHEDULED_TASK_TOOL,
  PAUSE_SCHEDULED_TASK_TOOL,
  TRANSLATE_TEXT_TOOL,
  WEB_SEARCH_FETCH_TOOL,
  FETCH_URL_CONTENT_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  GENERATE_DOCUMENT_TOOL,
  RENDER_DIAGRAM_TOOL,
  RENDER_SVG_TOOL,
  // UCA-053: File Discovery & Artifact Verification
  LIST_FILES_TOOL,
  GLOB_FILES_TOOL,
  FIND_RECENT_FILES_TOOL,
  GET_LATEST_ARTIFACT_TOOL,
  STAT_FILE_TOOL,
  READ_FILE_TEXT_TOOL,
  READ_FOLDER_TEXT_TOOL,
  SEARCH_FILE_CONTENT_TOOL,
  INDEX_FILE_CONTENT_TOOL,
  VERIFY_FILE_EXISTS_TOOL,
  REGISTER_ARTIFACT_TOOL,
  RESOLVE_OUTPUT_PATH_TOOL,
  // UCA-076: GUI Automation
  GUI_FIND_ELEMENT_TOOL,
  GUI_CLICK_TOOL,
  GUI_TYPE_TEXT_TOOL,
  // Tool-backed vision specialist. Lets tool_using handle "what's in
  // this image" without bouncing the task to the multi_modal executor.
  VISION_ANALYZE_TOOL,
  // UCA-182 Phase 21: memory introspection tools so the planner can
  // ask for prior-task context on its own, replacing the earlier
  // submit-time digest injection.
  ...MEMORY_TOOLS,
  // UCA-077: Capability creator (skill / MCP), draft-only and read-only.
  DRAFT_CAPABILITY_TOOL,
  // UCA-077: Save the capability draft. High-risk + confirmation-required;
  // never enables an MCP server or mutates runtime config.
  SAVE_CAPABILITY_DRAFT_TOOL,
  // C18 #2b: two-step LLM-callable skill install. Preview (low risk,
  // no confirmation) stages + returns SKILL.md preview + state token.
  // Install (high risk, requires_confirmation) consumes the token to
  // commit. Surface gating in tool-surface.mjs.shouldExposeSkillInstall
  // requires user_command to contain BOTH an install verb AND a
  // github.com URL in the same source.
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL,
  // Connector catalog + provider account tools (single aggregation point)
  ...CONNECTOR_ACTION_TOOLS
]);
