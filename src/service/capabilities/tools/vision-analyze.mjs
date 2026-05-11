/**
 * vision_analyze — tool-backed specialist for image understanding.
 *
 * Lets the tool_using orchestrator stay a single brain: when the user
 * asks something visual ("这是什么", "读出图里的字", "比较这两张图"),
 * the planner calls this tool with the absolute paths of the attached
 * images. We resolve the routed Vision provider, load the bytes, hit
 * the right Vision API (Anthropic vs OpenAI-compat), and return text
 * the orchestrator can then weave into its answer or feed to a
 * follow-up tool (compose_email, write_file, …).
 *
 * NOT a generic subagent framework. When a second specialist of the
 * same shape exists (file_deep_analysis, code_review) we'll extract
 * the common surface from real duplication.
 */

import path from "node:path";
import { ACTION_TOOL_SCHEMAS } from "../../action_tools/schemas/index.mjs";
import { createActionResult } from "../../action_tools/types.mjs";
import { resolveProviderForTask } from "../../executors/shared/provider-resolver.mjs";
import {
  callAnthropicVision,
  callOpenAIVision,
  loadImageAsBase64
} from "../../executors/multi_modal/multi-modal-executor.mjs";

const MAX_IMAGES_PER_CALL = 4;
const IMAGE_ARTIFACT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

// Windows is case-insensitive at the filesystem layer; macOS/Linux can be
// either depending on volume. Use a normalised key so "C:\\Foo\\bar.png"
// and "c:/foo/bar.png" hash to the same allowlist entry.
function pathKey(p) {
  if (!p) return "";
  try {
    return path.resolve(`${p}`).toLowerCase();
  } catch {
    return `${p}`.trim().toLowerCase();
  }
}

function normalizeImagePaths(args = {}) {
  const raw = args.image_paths
    ?? args.imagePaths
    ?? args.paths
    ?? args.path
    ?? args.image_path;
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    const value = `${entry ?? ""}`.trim();
    if (!value) continue;
    const key = pathKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isImageArtifactPath(value = "") {
  return IMAGE_ARTIFACT_EXTENSIONS.has(path.extname(`${value ?? ""}`).toLowerCase());
}

function collectGeneratedImageArtifacts(transcript = []) {
  const out = [];
  for (const entry of Array.isArray(transcript) ? transcript : []) {
    if (!entry || entry.success === false) continue;
    const paths = [
      ...(Array.isArray(entry.artifact_paths) ? entry.artifact_paths : []),
      ...(Array.isArray(entry.result?.artifact_paths) ? entry.result.artifact_paths : []),
      entry.metadata?.path
    ].filter(Boolean);
    for (const candidate of paths) {
      const value = `${candidate ?? ""}`.trim();
      if (value && isImageArtifactPath(value)) out.push(value);
    }
  }
  return out;
}

// Codex high-severity finding: the planner-supplied `image_paths`
// argument is untrusted from a security standpoint — combining
// file_read with remote provider upload means a runaway or prompt-
// injected planner could exfiltrate arbitrary local files by passing
// their paths here. Constrain the inputs to paths the user actually
// attached to THIS task (context_packet.{image_paths, file_paths}).
// Anything else is refused with a useful observation. This is a hard
// gate, not advisory prompt language.
function buildAttachedAllowlist(ctx) {
  const cp = ctx?.task?.context_packet ?? {};
  const candidates = [
    ...(Array.isArray(cp.image_paths) ? cp.image_paths : []),
    // file_paths is also accepted because submitImageTask mirrors image
    // attachments into both lists when forwarding to a connector send,
    // and the user-supplied attachment surface is identical.
    ...(Array.isArray(cp.file_paths) ? cp.file_paths : []),
    // Same-task generated screenshots are user-authorized context too:
    // take_screenshot writes a PNG artifact, then the planner can pass that
    // path to vision_analyze. This is still a structural allowlist, not an
    // arbitrary local path escape hatch.
    ...collectGeneratedImageArtifacts(ctx?.transcript)
  ].map((entry) => `${entry ?? ""}`.trim()).filter(Boolean);

  const allowed = new Map(); // key → original spelling (for error messages)
  for (const candidate of candidates) {
    const key = pathKey(candidate);
    if (!allowed.has(key)) allowed.set(key, candidate);
  }
  return allowed;
}

// Private helper: keeps base64 prep / Anthropic-vs-OpenAI routing /
// error normalisation out of the tool body. Concern separation, not
// abstraction — there is exactly one caller.
//
// Codex medium-severity finding: mirror the multi_modal `mustSwitch`
// guard so a provider explicitly marked supportsVision:false (or an
// Ollama serving a non-vision model) cannot receive image bytes
// just because the resolver routed `vision` to it. The tool refuses
// rather than auto-falling-back; multi_modal still performs the
// fallback dance for users who rely on legacy direct vision routing.
async function callVisionProvider({ provider, prompt, images, signal }) {
  if (!provider) {
    throw new Error("No Vision-capable provider configured. Open Console → Settings → Routing → Vision and pick a provider that supports images (GPT-4o, Gemini, Qwen-VL, Claude vision, 豆包, GLM-4V, Pixtral …).");
  }
  if (provider.kind === "code_cli") {
    throw new Error(`vision_analyze cannot delegate to a code_cli provider (${provider.providerName ?? provider.id}). Pick an API-based vision provider in Settings → Routing → Vision, or let multi_modal route the job to the CLI directly.`);
  }
  if (provider.supportsVision === false) {
    throw new Error(`The configured Vision provider (${provider.providerName ?? provider.id}) is marked supportsVision:false. Pick an image-capable provider in Settings → Routing → Vision.`);
  }
  // Codex review: callOpenAIVision posts to `${baseUrl}/chat/completions`,
  // which for Ollama's default baseUrl `http://127.0.0.1:11434` becomes
  // `/chat/completions` — wrong on both counts (Ollama's native path is
  // `/api/chat`; its OpenAI-compat path is `/v1/chat/completions`).
  // Until a real Ollama vision path exists, refuse rather than fire a
  // request that will 404. multi_modal still has its own Ollama
  // handling (or lack thereof) and is unaffected by this gate.
  if (provider.kind === "ollama") {
    throw new Error(`vision_analyze does not yet support Ollama (${provider.providerName ?? provider.id}). The OpenAI-compat helper would post to the wrong path; needs a dedicated /api/chat route. For now, route Vision to an Anthropic / OpenAI-compatible vision provider.`);
  }
  if (provider.id === "anthropic" || provider.kind === "anthropic") {
    return callAnthropicVision({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      userCommand: prompt,
      images,
      signal
    });
  }
  return callOpenAIVision({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: provider.model,
    userCommand: prompt,
    images,
    signal
  });
}

// Test-only export. Surface for unit tests so the Ollama / supportsVision
// gates can be exercised without monkey-patching the resolver. Not part
// of the public tool surface.
export const __test = Object.freeze({ callVisionProvider, buildAttachedAllowlist, collectGeneratedImageArtifacts });

export const VISION_ANALYZE_TOOL = {
  id: "vision_analyze",
  name: "Vision Analyze",
  description: "Analyse one or more local image files using the configured Vision provider and return text. Use this when the user asks what is shown in a picture, to read text/OCR from a screenshot, to compare images, or to summarise visual content. Pass `image_paths` (absolute paths from Resources → Attached images) and a short `prompt` describing what to extract. DO NOT call this just to send / forward / open / upload / reveal an image — those are connector / file-tool jobs. If the chat provider already accepted the image as an inline block in this turn, you can answer directly without calling this tool.",
  parameters: ACTION_TOOL_SCHEMAS.vision_analyze,
  risk_level: "low",
  required_capabilities: ["network", "file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    // Test seam: ctx._testSeam allows stubbing provider resolution,
    // image loading, and vision provider calls for verifier coverage.
    // Not part of the public tool surface.
    const _resolveProvider = ctx._testSeam?.resolveProvider ?? resolveProviderForTask;
    const _loadImage = ctx._testSeam?.loadImage ?? loadImageAsBase64;
    const _callVision = ctx._testSeam?.callVision ?? callVisionProvider;

    const prompt = String(
      args.prompt ?? args.question ?? args.instruction ?? "Describe this image in detail."
    ).trim() || "Describe this image in detail.";

    const requestedPaths = normalizeImagePaths(args);
    if (requestedPaths.length === 0) {
      return createActionResult({
        success: false,
        observation: "vision_analyze requires `image_paths` — pass the absolute path(s) of the attached image(s) listed in Resources → Attached images."
      });
    }

    // Codex high-severity finding: enforce the allowlist HERE, before
    // we touch the filesystem. Paths the user did not explicitly
    // attach to this task are refused with a useful observation so
    // the planner can recover (ask the user to re-attach).
    const allowed = buildAttachedAllowlist(ctx);
    if (allowed.size === 0) {
      return createActionResult({
        success: false,
        observation: "vision_analyze refused: no image was attached to this task. Ask the user to attach the image (drag/drop into the side panel or Console)."
      });
    }
    const acceptedPaths = [];
    const rejectedPaths = [];
    for (const candidate of requestedPaths) {
      if (allowed.has(pathKey(candidate))) {
        acceptedPaths.push(candidate);
      } else {
        rejectedPaths.push(candidate);
      }
    }
    // Codex review: a "compare these two" call where one path is
    // attached and one isn't was previously slicing to acceptedPaths
    // and reporting success — the user's intent (a comparison) was
    // silently destroyed. Be strict: any rejected path is a hard
    // failure. The planner can retry with the attached set after the
    // user clarifies / re-attaches.
    if (rejectedPaths.length > 0) {
      const attachedList = [...allowed.values()];
      const reason = acceptedPaths.length === 0
        ? "none of the requested paths are attached to this task"
        : "some of the requested paths are not attached to this task — partial calls would silently drop the user's intent (e.g. a comparison)";
      return createActionResult({
        success: false,
        observation: `vision_analyze refused: ${reason}. Attached images on this task: ${JSON.stringify(attachedList)}. Rejected paths: ${JSON.stringify(rejectedPaths)}.`,
        metadata: {
          tool_id: "vision_analyze",
          attached_image_paths: attachedList,
          rejected_image_paths: rejectedPaths,
          accepted_image_paths: acceptedPaths
        }
      });
    }

    const provider = _resolveProvider("vision");

    const images = [];
    for (const p of acceptedPaths.slice(0, MAX_IMAGES_PER_CALL)) {
      try {
        images.push(await _loadImage(p));
      } catch (error) {
        return createActionResult({
          success: false,
          observation: `Failed to read image ${p}: ${error.message}`
        });
      }
    }

    try {
      const text = await _callVision({
        provider,
        prompt,
        images,
        signal: ctx?.signal ?? null
      });
      const observation = text && text.trim()
        ? text
        : "(vision provider returned no text)";
      return createActionResult({
        success: true,
        observation,
        metadata: {
          tool_id: "vision_analyze",
          provider: provider?.providerName ?? provider?.id ?? null,
          model: provider?.model ?? null,
          image_count: images.length,
          image_paths: acceptedPaths.slice(0, MAX_IMAGES_PER_CALL)
        }
      });
    } catch (error) {
      if (error?.code === "ABORT_ERR" || error?.name === "AbortError") {
        throw error;
      }
      return createActionResult({
        success: false,
        observation: `vision_analyze failed: ${error.message}`
      });
    }
  }
};
