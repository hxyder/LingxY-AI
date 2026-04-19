import http from "node:http";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { promisify } from "node:util";
import readline from "node:readline";
import { createTaskEventStream, encodeSseFrame, SSE_HEADERS } from "../events/sse.mjs";
import { retryTask } from "../retry/retry-manager.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { cancelTask, emitTaskEvent } from "./task-runtime.mjs";
import { tryFastPath } from "./router/fast-path-router.mjs";
import { submitActionToolTask } from "./action-tool-submission.mjs";
import { submitBrowserTask } from "./browser-submission.mjs";
import { submitContextTask } from "./context-submission.mjs";
import { submitFileTask } from "./file-submission.mjs";
import { submitImageTask } from "./image-submission.mjs";
import { submitOfficeTask } from "./office-submission.mjs";
import { listEmailAccounts, upsertEmailAccount, deleteEmailAccount } from "../email/accounts.mjs";
import {
  startMicrosoftAuth, startGoogleAuth,
  completeOAuthCallback, disconnectAccount,
  getConnectorStatus, loadConnectorConfig, saveConnectorConfig,
  listFiles, listEmails, listCalendarEvents
} from "../connectors/account-connectors.mjs";
import { maybeRunMorningDigest } from "../email/digest.mjs";
import { saveAutoSkill } from "./skill-pattern-tracker.mjs";
import { normalizeTemplateDocument } from "../templates/parser.mjs";
import { validateTemplateDocument } from "../templates/schema.mjs";
import { resumeDagGraph, validateDagDefinition } from "../dag/scheduler.mjs";
import { detectAmbiguity } from "./clarifier.mjs";
import { parseRelativeTime, formatRelativeDuration } from "../utils/time-parser.mjs";
import { resolveProviderForTask } from "../executors/shared/provider-resolver.mjs";
import { extractPageContent } from "../extractors/page_source/index.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCAL_WHISPER_MODEL = "base";
const DEFAULT_LOCAL_WHISPER_BEAM_SIZE = "1";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function expandLocalPath(value) {
  if (!value) return null;
  return `${value}`
    .replaceAll("%CODEX_HOME%", process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
    .replaceAll("%USERPROFILE%", os.homedir())
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

function isPathInside(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath).toLowerCase();
  const root = path.resolve(rootPath).toLowerCase();
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveSkillEntryPath(runtime, entryPath) {
  if (!entryPath || path.basename(entryPath) !== "SKILL.md") {
    return null;
  }
  const config = runtime.configStore?.load?.() ?? {};
  const roots = [
    runtime.paths?.skillsDir,
    path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "skills"),
    ...(config.ai?.skills?.registries ?? []).map((registry) => expandLocalPath(registry.rootPath ?? registry.path))
  ].filter(Boolean);
  const resolved = path.resolve(entryPath);
  return roots.some((root) => isPathInside(resolved, root)) ? resolved : null;
}

function readApiKey(env, ...keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isOfficialOpenAIBaseUrl(baseUrl = "") {
  try {
    const url = new URL(baseUrl || "https://api.openai.com/v1");
    return url.hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function providerSupportsAudioTranscription(provider = {}) {
  if (provider.kind !== "openai" || !provider.apiKey) return false;
  if (provider.audioTranscription === true || provider.capabilities?.audioTranscription === true) return true;
  // Avoid sending audio to chat-only OpenAI-compatible providers like DeepSeek.
  return isOfficialOpenAIBaseUrl(provider.baseUrl);
}

function providerPublicDescriptor(provider = null) {
  if (!provider) return null;
  return {
    id: provider.configId ?? provider.id ?? null,
    kind: provider.kind ?? null,
    name: provider.providerName ?? provider.name ?? null,
    baseUrl: provider.baseUrl ?? null,
    model: provider.model ?? provider.defaultModel ?? null
  };
}

function pickAudioTranscriptionModel(provider = {}, fallback = "whisper-1") {
  const explicit = provider.audioTranscriptionModel || provider.transcriptionModel;
  if (explicit) return explicit;
  const defaultModel = `${provider.defaultModel ?? ""}`.trim();
  if (defaultModel === "whisper-1" || /transcribe/.test(defaultModel)) return defaultModel;
  return fallback;
}

function resolveAudioTranscriptionProvider(runtime, env = process.env) {
  const envKey = readApiKey(env, "UCA_TRANSCRIPTION_API_KEY", "OPENAI_API_KEY", "UCA_OPENAI_API_KEY");
  if (envKey) {
    return {
      id: "openai",
      configId: "audio-env",
      kind: "openai",
      apiKey: envKey,
      baseUrl: env.UCA_TRANSCRIPTION_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.UCA_TRANSCRIPTION_MODEL ?? "whisper-1",
      providerName: "OpenAI transcription (env)"
    };
  }

  const config = runtime.configStore?.load?.() ?? {};
  const providers = config.ai?.customProviders ?? [];
  const audioRoute = config.ai?.taskRouting?.audio_transcription;
  if (audioRoute?.providerId) {
    const routed = providers.find((provider) => provider.id === audioRoute.providerId);
    if (providerSupportsAudioTranscription(routed)) {
      return {
        id: "openai",
        configId: routed.id,
        kind: routed.kind,
        apiKey: routed.apiKey,
        baseUrl: routed.baseUrl,
        model: audioRoute.model || pickAudioTranscriptionModel(routed),
        providerName: routed.name
      };
    }
  }

  const provider = providers.find(providerSupportsAudioTranscription);
  if (!provider) return null;
  return {
    id: "openai",
    configId: provider.id,
    kind: provider.kind,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: pickAudioTranscriptionModel(provider),
    providerName: provider.name
  };
}

function normalizeLanguageHint(lang = "auto") {
  if (!lang || lang === "auto") return "auto";
  return lang.split("-")[0];
}

function getLocalTranscriptionScriptPath() {
  return path.resolve(process.cwd(), "scripts", "local-whisper-transcribe.py");
}

function getLocalKeywordSpottingScriptPath() {
  return path.resolve(process.cwd(), "scripts", "local-sherpa-kws.py");
}

function getPythonCommand() {
  if (process.env.UCA_PYTHON_PATH) return process.env.UCA_PYTHON_PATH;
  const venvPython = process.platform === "win32"
    ? path.resolve(process.cwd(), ".venv", "Scripts", "python.exe")
    : path.resolve(process.cwd(), ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : "python";
}

function parseLastJsonLine(stdoutText = "") {
  const jsonLine = `${stdoutText ?? ""}`
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  return JSON.parse(jsonLine || "{}");
}

async function getLocalKeywordSpottingStatus() {
  try {
    const { stdout } = await execFileAsync(getPythonCommand(), [
      getLocalKeywordSpottingScriptPath(),
      "--check"
    ], {
      timeout: Number(process.env.UCA_SHERPA_KWS_CHECK_TIMEOUT_MS ?? 12_000),
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      encoding: "utf8"
    });
    return parseLastJsonLine(stdout);
  } catch (error) {
    return {
      ok: false,
      reason: "kws_check_failed",
      message: error?.message ?? String(error)
    };
  }
}

async function detectWakeKeywordLocally(audioBuffer, { mimeType = "audio/webm" } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-echo-kws-"));
  const ext = mimeType.includes("wav") ? ".wav"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? ".mp3"
        : ".webm";
  const audioPath = path.join(tempDir, `echo-window${ext}`);
  try {
    await writeFile(audioPath, audioBuffer);
    const { stdout } = await execFileAsync(getPythonCommand(), [
      getLocalKeywordSpottingScriptPath(),
      audioPath
    ], {
      timeout: Number(process.env.UCA_SHERPA_KWS_REQUEST_TIMEOUT_MS ?? 12_000),
      maxBuffer: 1024 * 1024 * 2,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      encoding: "utf8"
    });
    return parseLastJsonLine(stdout);
  } catch (error) {
    const details = [
      error.message,
      typeof error.stdout === "string" && error.stdout.trim() ? `stdout: ${error.stdout.trim().slice(-1000)}` : "",
      typeof error.stderr === "string" && error.stderr.trim() ? `stderr: ${error.stderr.trim().slice(-1000)}` : ""
    ].filter(Boolean).join("\n");
    return {
      ok: false,
      reason: "kws_failed",
      message: details
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeAudioLocally(audioBuffer, { mimeType = "audio/webm", lang = "auto" } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-note-audio-"));
  const ext = mimeType.includes("wav") ? ".wav"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? ".mp3"
        : ".webm";
  const audioPath = path.join(tempDir, `note-recording${ext}`);
  try {
    await writeFile(audioPath, audioBuffer);
    const pythonCommand = getPythonCommand();
    const scriptPath = getLocalTranscriptionScriptPath();
    const { stdout } = await execFileAsync(pythonCommand, [
      scriptPath,
      audioPath,
      "--language",
      normalizeLanguageHint(lang),
      "--model",
      process.env.UCA_LOCAL_WHISPER_MODEL || DEFAULT_LOCAL_WHISPER_MODEL,
      "--device",
      process.env.UCA_LOCAL_WHISPER_DEVICE || "cpu",
      "--compute-type",
      process.env.UCA_LOCAL_WHISPER_COMPUTE_TYPE || "int8",
      "--beam-size",
      process.env.UCA_LOCAL_WHISPER_BEAM_SIZE || DEFAULT_LOCAL_WHISPER_BEAM_SIZE
    ], {
      timeout: Number(process.env.UCA_LOCAL_WHISPER_TIMEOUT_MS ?? 30 * 60_000),
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8"
      },
      encoding: "utf8"
    });
    const stdoutText = stdout.trim();
    const jsonLine = stdoutText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));
    const result = JSON.parse(jsonLine || stdoutText || "{}");
    return {
      ...result,
      provider: {
        id: "local-faster-whisper",
        kind: "local",
        name: "Local faster-whisper",
        model: result.model ?? process.env.UCA_LOCAL_WHISPER_MODEL ?? DEFAULT_LOCAL_WHISPER_MODEL
      }
    };
  } catch (error) {
    const details = [
      error.message,
      typeof error.stdout === "string" && error.stdout.trim() ? `stdout: ${error.stdout.trim().slice(-1000)}` : "",
      typeof error.stderr === "string" && error.stderr.trim() ? `stderr: ${error.stderr.trim().slice(-1000)}` : ""
    ].filter(Boolean).join("\n");
    return {
      ok: false,
      reason: "local_transcription_failed",
      message: details
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Streaming variant of transcribeAudioLocally: spawns the Python sidecar with
// --stream so each decoded segment is emitted immediately, and pipes every
// stdout line through onEvent as a parsed JSON object ({type:"segment"|"done"|
// "error", ...}). Returns a promise that resolves when the child exits.
// Used by the SSE branch of /note/transcribe so the client sees partial text
// as faster-whisper decodes instead of waiting for the whole file.
async function transcribeAudioLocallyStream(audioBuffer, { mimeType = "audio/webm", lang = "auto" } = {}, onEvent) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-note-audio-"));
  const ext = mimeType.includes("wav") ? ".wav"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? ".mp3"
        : ".webm";
  const audioPath = path.join(tempDir, `note-recording${ext}`);
  try {
    await writeFile(audioPath, audioBuffer);
    const pythonCommand = getPythonCommand();
    const scriptPath = getLocalTranscriptionScriptPath();
    const child = spawn(pythonCommand, [
      scriptPath,
      audioPath,
      "--language", normalizeLanguageHint(lang),
      "--model", process.env.UCA_LOCAL_WHISPER_MODEL || DEFAULT_LOCAL_WHISPER_MODEL,
      "--device", process.env.UCA_LOCAL_WHISPER_DEVICE || "cpu",
      "--compute-type", process.env.UCA_LOCAL_WHISPER_COMPUTE_TYPE || "int8",
      "--beam-size", String(process.env.UCA_LOCAL_WHISPER_BEAM_SIZE || DEFAULT_LOCAL_WHISPER_BEAM_SIZE),
      "--stream"
    ], {
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
    });

    const stderrChunks = [];
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return;
      try { onEvent(JSON.parse(trimmed)); }
      catch { /* ignore unparseable lines */ }
    });

    return await new Promise((resolve) => {
      child.on("error", (err) => {
        onEvent({ type: "error", reason: "spawn_failed", message: err.message });
        resolve({ ok: false, reason: "spawn_failed" });
      });
      child.on("close", (code) => {
        rl.close();
        if (code !== 0) {
          const stderrText = Buffer.concat(stderrChunks).toString("utf8").slice(-800);
          onEvent({ type: "error", reason: "python_exit", code, message: stderrText });
        }
        resolve({ ok: code === 0 });
      });
    });
  } catch (error) {
    onEvent({ type: "error", reason: "stream_setup_failed", message: error.message });
    return { ok: false, reason: "stream_setup_failed" };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeOverlayHandoff(body) {
  const handoffDir = path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");
  await mkdir(handoffDir, { recursive: true });
  const handoffPath = path.join(handoffDir, `prompt-handoff-${crypto.randomUUID().replaceAll("-", "")}.json`);
  const payload = {
    schema_version: "1.0",
    targetWindow: "overlay",
    source_app: body.capture?.browser ?? body.source_app ?? "chrome.exe",
    capture_mode: body.captureMode ?? body.capture_mode ?? "browser_extension",
    userCommand: body.userCommand ?? "请处理当前网页上下文",
    capture: body.capture ?? null,
    // Optional: prior turn from an inline-result frame, so the overlay can
    // render the previous Q + A as conversation history and the user can
    // immediately type a follow-up.
    priorResult: body.priorResult ?? null,
    priorUserCommand: body.priorUserCommand ?? null,
    captured_at: new Date().toISOString()
  };
  await writeFile(handoffPath, `${JSON.stringify(payload)}\n`, "utf8");
  return {
    accepted: true,
    delivery: "overlay",
    handoffPath
  };
}

// Turn a raw page-source capture (from the browser extension) into a normalised
// capture packet + user command that the overlay can run through the standard
// context-submission pipeline. Keeps the extension dumb (it only knows "this is
// what's on the page") and centralises all prompt / routing logic here.
function buildExplainPagePayload(capturePayload, extraction) {
  const userLang = `${capturePayload?.lang ?? ""}`.toLowerCase();
  const isEnglish = userLang.startsWith("en");

  let userCommand;
  let captureText;

  if (extraction.kind === "video") {
    if (!extraction.text) {
      // Captions missing entirely — translate the raw error code into a
      // human suggestion so the user has a clear next step.
      const reason = extraction.reason ?? "unknown";
      let userHint;
      if (/transcript_unavailable|transcript_button_not_found/.test(reason)) {
        userHint = "UCA 无法自动打开这个视频的「显示转录 / Show transcript」面板。你可以：\n1) 手动展开视频描述，点击「显示转录」按钮，然后重试 Ctrl+Shift+E；\n2) 或切换到 UCA「录音笔记」模式录制 2-3 分钟音频做转写。";
      } else if (/transcript_panel_timeout/.test(reason)) {
        userHint = "字幕面板打开了但加载超时。请手动确认面板已出现后重试 Ctrl+Shift+E，或改用录音笔记。";
      } else if (/no_captions_available/.test(reason)) {
        userHint = "该视频没有上传官方字幕，YouTube 也没有生成自动字幕。建议使用 UCA「录音笔记」录制视频音频再转写。";
      } else if (/http_200_empty|caption_fetch_empty/.test(reason)) {
        userHint = "YouTube 拒绝了字幕接口（PoT 反爬），DOM 抓取也没成功。手动展开描述并点一下「显示转录」后重试 Ctrl+Shift+E，或改用录音笔记。";
      } else {
        userHint = "抓取字幕失败。可手动打开视频下方的「显示转录」面板后重试，或使用 UCA 录音笔记。";
      }
      captureText = [
        `视频标题：${extraction.title ?? ""}`,
        `作者：${extraction.author ?? ""}`,
        `时长：${extraction.lengthSeconds}s`,
        `链接：${extraction.url ?? ""}`,
        "",
        `⚠️ 未能抓取到字幕（${reason}）`,
        "",
        userHint
      ].join("\n");
      userCommand = "请以清晰、友好的中文把下方的错误原因和建议告诉用户，不要尝试推测视频内容。";
    } else {
      captureText = [
        `视频标题：${extraction.title ?? ""}`,
        `作者：${extraction.author ?? ""}`,
        `时长：${Math.round((extraction.lengthSeconds ?? 0) / 60)} 分钟`,
        `来源：${extraction.url ?? ""}`,
        "",
        "带时间戳的完整字幕：",
        extraction.text
      ].join("\n");
      userCommand = isEnglish
        ? "Give a structured, interactive explanation of this video. Output in markdown:\n" +
          "## 一句话\n<one-sentence summary>\n\n" +
          "## 要点\n- 3 to 5 bullets covering the core ideas\n\n" +
          "## 分段讲解\n" +
          "For each logical section of the video, use `### [MM:SS] 标题`, then a paragraph that lets the reader skip the video. Preserve the speaker's key claims, numbers and examples."
        : "请对这个视频做一次结构化、可互动的完整讲解，markdown 格式：\n" +
          "## 一句话\n<一句话概括>\n\n" +
          "## 要点\n- 3–5 条覆盖核心观点\n\n" +
          "## 分段讲解\n" +
          "每个主题段落用 `### [MM:SS] 小标题`，然后一段能让读者跳过视频的详细讲解，保留说话者的关键主张、数据和例子。";
    }
  } else if (extraction.kind === "article" || extraction.kind === "fallback") {
    const title = extraction.title ?? "";
    const byline = extraction.byline ?? "";
    const siteName = extraction.siteName ?? "";
    captureText = [
      `文章标题：${title}`,
      byline ? `作者：${byline}` : "",
      siteName ? `站点：${siteName}` : "",
      `链接：${extraction.url ?? ""}`,
      "",
      "正文内容：",
      extraction.text ?? ""
    ].filter(Boolean).join("\n");
    userCommand = isEnglish
      ? "Give a structured, interactive explanation of this article. Output in markdown:\n" +
        "## 一句话\n<one-sentence summary>\n\n" +
        "## 要点\n- 3 to 5 bullets\n\n" +
        "## 分段讲解\n" +
        "Follow the article's own sections with `### 小标题` headings; each section one paragraph that preserves claims, data, examples."
      : "请对这篇文章做一次结构化、可互动的完整讲解，markdown 格式：\n" +
        "## 一句话\n<一句话概括>\n\n" +
        "## 要点\n- 3–5 条\n\n" +
        "## 分段讲解\n" +
        "按文章的结构用 `### 小标题` 分段；每段一个完整段落，保留关键主张、数据、例子。";
  } else {
    captureText = `无法识别页面类型（${extraction.kind ?? "unknown"}）。URL: ${capturePayload?.url ?? ""}`;
    userCommand = "请告知用户当前页面无法被抽取成视频或文章，建议手动复制内容再提问。";
  }

  return {
    userCommand,
    capture: {
      sourceType: "page_explanation",
      text: captureText,
      url: capturePayload?.url ?? "",
      pageTitle: extraction.title ?? capturePayload?.title ?? "",
      browser: capturePayload?.browser ?? "chrome.exe",
      metadata: {
        contentKind: extraction.kind,
        platform: extraction.platform ?? capturePayload?.platform ?? "generic",
        captionFormat: extraction.captionFormat ?? null,
        captionLang: extraction.captionLang ?? null,
        segmentCount: Array.isArray(extraction.segments) ? extraction.segments.length : 0,
        lengthChars: extraction.lengthChars ?? null,
        lengthSeconds: extraction.lengthSeconds ?? null
      }
    }
  };
}

export async function handlePageExplain(body) {
  const capturePayload = body?.capture ?? body ?? {};
  const extraction = await extractPageContent({
    url: capturePayload.url ?? "",
    html: capturePayload.html ?? "",
    youtubeCaptionTracks: capturePayload?.youtube?.captionTracks ?? null,
    videoMetadata: capturePayload?.youtube ? {
      title: capturePayload.youtube.title,
      author: capturePayload.youtube.author,
      lengthSeconds: capturePayload.youtube.lengthSeconds,
      url: capturePayload.url ?? ""
    } : null,
    preferredLangs: capturePayload.lang ? [capturePayload.lang] : [],
    preFetchedTranscript: capturePayload?.youtube ? {
      segments: capturePayload.youtube.transcriptSegments ?? [],
      body: capturePayload.youtube.transcriptBody ?? "",
      format: capturePayload.youtube.transcriptFormat ?? "none",
      error: capturePayload.youtube.transcriptError ?? null
    } : null,
    selectedCaption: capturePayload?.youtube?.selectedCaption ?? null
  });

  if (!extraction || extraction.ok === false) {
    return { accepted: false, reason: extraction?.reason ?? "extraction_failed" };
  }

  const shell = buildExplainPagePayload(capturePayload, extraction);
  const handoffResult = await writeOverlayHandoff({
    source_app: capturePayload.browser ?? "chrome.exe",
    captureMode: "explain_page",
    userCommand: shell.userCommand,
    capture: shell.capture
  });

  return {
    accepted: true,
    contentKind: extraction.kind,
    delivery: handoffResult.delivery,
    handoffPath: handoffResult.handoffPath,
    reason: extraction.reason ?? null
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const RECENT_BROWSER_CONTEXT_LIMIT = 30;
const RECENT_BROWSER_CONTEXT_TTL_MS = 30 * 60 * 1000;

function truncateString(value = "", maxLength = 1000) {
  const text = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeMatchText(value = "") {
  return `${value ?? ""}`
    .toLowerCase()
    .replace(/\s+-\s+(youtube|google chrome|microsoft edge|mozilla firefox).*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrlHost(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeBrowserContextPayload(body = {}) {
  const raw = body.context ?? body;
  const metadata = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const youtube = metadata.youtube && typeof metadata.youtube === "object" ? metadata.youtube : null;
  const capturedAt = metadata.capturedAt || raw.capturedAt || new Date().toISOString();

  return {
    sourceType: truncateString(raw.sourceType ?? raw.source_type ?? "web_page", 80),
    browser: truncateString(raw.browser ?? "chrome.exe", 80),
    url: truncateString(raw.url ?? youtube?.canonicalUrl ?? "", 2000),
    pageTitle: truncateString(raw.pageTitle ?? raw.title ?? youtube?.title ?? "", 500),
    text: truncateString(raw.text ?? "", 8000),
    metadata: {
      capturedAt,
      platform: truncateString(metadata.platform ?? youtube?.platform ?? "", 80) || null,
      description: truncateString(metadata.description ?? youtube?.description ?? "", 2000),
      youtube: youtube ? {
        platform: "youtube",
        videoId: truncateString(youtube.videoId ?? "", 100),
        canonicalUrl: truncateString(youtube.canonicalUrl ?? raw.url ?? "", 2000),
        title: truncateString(youtube.title ?? raw.pageTitle ?? "", 500),
        channel: truncateString(youtube.channel ?? "", 300),
        description: truncateString(youtube.description ?? "", 2000),
        visibleCaptions: truncateString(youtube.visibleCaptions ?? "", 2400)
      } : null
    }
  };
}

function rememberBrowserContext(recentBrowserContexts, context) {
  const now = Date.now();
  const contextUrl = context.url || context.metadata?.youtube?.canonicalUrl || "";
  const next = {
    ...context,
    receivedAt: new Date(now).toISOString()
  };

  const existingIndex = contextUrl
    ? recentBrowserContexts.findIndex((item) => item.url === contextUrl || item.metadata?.youtube?.canonicalUrl === contextUrl)
    : -1;
  if (existingIndex >= 0) {
    recentBrowserContexts.splice(existingIndex, 1);
  }

  recentBrowserContexts.unshift(next);
  const cutoff = now - RECENT_BROWSER_CONTEXT_TTL_MS;
  for (let index = recentBrowserContexts.length - 1; index >= 0; index -= 1) {
    const received = Date.parse(recentBrowserContexts[index].receivedAt ?? recentBrowserContexts[index].metadata?.capturedAt ?? "") || 0;
    if (recentBrowserContexts.length > RECENT_BROWSER_CONTEXT_LIMIT || received < cutoff) {
      recentBrowserContexts.splice(index, 1);
    }
  }
  return next;
}

function scoreBrowserContext(context, { url = "", title = "" } = {}) {
  let score = 0;
  const contextUrl = context.url || context.metadata?.youtube?.canonicalUrl || "";
  const contextTitle = context.pageTitle || context.metadata?.youtube?.title || "";
  const normalizedTitle = normalizeMatchText(title);
  const normalizedContextTitle = normalizeMatchText(contextTitle);

  if (url && contextUrl) {
    if (contextUrl === url) score += 100;
    else if (safeUrlHost(contextUrl) && safeUrlHost(contextUrl) === safeUrlHost(url)) score += 18;
  }

  if (normalizedTitle && normalizedContextTitle) {
    if (normalizedTitle.includes(normalizedContextTitle) || normalizedContextTitle.includes(normalizedTitle)) {
      score += 55;
    } else {
      const titleTokens = new Set(normalizedTitle.split(" ").filter((token) => token.length > 2));
      const contextTokens = normalizedContextTitle.split(" ").filter((token) => token.length > 2);
      const overlap = contextTokens.filter((token) => titleTokens.has(token)).length;
      score += Math.min(40, overlap * 6);
    }
  }

  const receivedAt = Date.parse(context.receivedAt ?? context.metadata?.capturedAt ?? "") || 0;
  if (receivedAt) score += Math.max(0, 20 - Math.floor((Date.now() - receivedAt) / 60_000));
  return score;
}

function listRecentBrowserContexts(recentBrowserContexts, query = {}) {
  const limit = Math.max(1, Math.min(10, Number(query.limit ?? 3) || 3));
  return recentBrowserContexts
    .map((context) => ({ context, score: scoreBrowserContext(context, query) }))
    .filter((item) => !query.url && !query.title ? true : item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({ ...item.context, score: item.score }));
}

function audioExtensionForMime(mimeType = "") {
  const mime = mimeType.toLowerCase();
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

function sanitizeFileName(value = "", fallback = "artifact") {
  const name = path.basename(`${value ?? ""}`).replace(/[<>:"/\\|?*]/g, "_").trim();
  return name || fallback;
}

async function resolveTaskArtifactOutputDir({ runtime, artifactStore, task }) {
  const existingArtifact = runtime.store.getArtifactsForTask?.(task.task_id)?.[0];
  if (existingArtifact?.path) {
    return path.dirname(existingArtifact.path);
  }
  const configuredDir = runtime?.configStore?.load?.()?.output?.defaultDir;
  if (typeof configuredDir === "string" && configuredDir.trim()) {
    const taskDir = path.join(configuredDir.trim(), task.task_id);
    await mkdir(taskDir, { recursive: true });
    return taskDir;
  }
  return artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
}

async function saveTaskAudioArtifact({ runtime, taskId, body }) {
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return { ok: false, statusCode: 404, error: "task_not_found" };
  }

  const mimeType = truncateString(body.mimeType ?? "audio/webm", 120) || "audio/webm";
  const channel = truncateString(body.channel ?? "system", 80) || "system";
  const audioBase64 = `${body.audio ?? ""}`.replace(/^data:[^;]+;base64,/, "").trim();
  if (!audioBase64) {
    return { ok: false, statusCode: 400, error: "missing_audio" };
  }

  const audioBuffer = Buffer.from(audioBase64, "base64");
  if (audioBuffer.length === 0) {
    return { ok: false, statusCode: 400, error: "empty_audio" };
  }
  if (audioBuffer.length > 1024 * 1024 * 200) {
    return { ok: false, statusCode: 413, error: "audio_too_large" };
  }

  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const outputDir = await resolveTaskArtifactOutputDir({ runtime, artifactStore, task });
  const ext = audioExtensionForMime(mimeType);
  const defaultName = channel === "mic" ? `输入音频${ext}` : `输出音频-系统音频${ext}`;
  const fileName = sanitizeFileName(body.fileName ?? defaultName, defaultName);
  const artifactPath = path.join(outputDir, fileName.endsWith(ext) ? fileName : `${fileName}${ext}`);
  await writeFile(artifactPath, audioBuffer);

  const artifactRecord = artifactStore.registerArtifact(task.task_id, artifactPath, mimeType);
  runtime.store.appendArtifact(artifactRecord);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "artifact_created",
    payload: {
      path: artifactPath,
      mime: mimeType,
      kind: "audio",
      channel,
      byteLength: audioBuffer.length
    }
  });
  return { ok: true, statusCode: 200, artifact: artifactRecord, byteLength: audioBuffer.length };
}

function listTaskSummaries(runtime) {
  return runtime.store.listTasks().map((task) => ({
    task_id: task.task_id,
    created_at: task.created_at,
    updated_at: task.updated_at,
    status: task.status,
    sub_status: task.sub_status,
    progress: task.progress ?? 0,
    intent: task.intent,
    executor: task.executor,
    source_type: task.context_packet?.source_type ?? null,
    source_app: task.context_packet?.source_app ?? null,
    capture_mode: task.context_packet?.capture_mode ?? null,
    user_command: task.user_command,
    parent_task_id: task.parent_task_id ?? null,
    child_index: task.child_index ?? null,
    child_count: Array.isArray(task.child_task_ids) ? task.child_task_ids.length : 0
  }));
}

function summarizeTask(runtime, taskId) {
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }
  return {
    task,
    events: runtime.store.getTaskEvents(taskId),
    artifacts: runtime.store.getArtifactsForTask(taskId)
  };
}

async function submitTaskFromBody(runtime, body) {
  // UCA-060: Reject requests with no user command — prevents the hotkey
  // "capture active window then send immediately" from using window content
  // as the query when the user hasn't typed anything yet.
  const userCommand = String(body.userCommand ?? "").trim();
  if (!userCommand) {
    return {
      ok: false,
      error: "missing_user_command",
      message: "请先输入你的问题或指令"
    };
  }
  // Write normalised command back so all branches below see the trimmed value
  body.userCommand = userCommand;
  const background = body.background === true || body.returnImmediately === true;

  // UCA-059: Clarify-before-act. If the command is ambiguous (missing referent,
  // missing recipient, etc.), return a clarification request instead of creating
  // a task. The overlay renders this as a follow-up question bubble.
  // Skip when the caller already supplies clarification context (previousCommand).
  if (!body.clarificationOf) {
    const ambiguity = detectAmbiguity(userCommand);
    if (ambiguity.needsClarification) {
      return {
        ok: true,
        type: "clarification_needed",
        question: ambiguity.question,
        ruleId: ambiguity.ruleId,
        original_command: userCommand
      };
    }
  }

  // UCA-066: Fast-path for deterministic Tier 0/1 actions.
  // Pure "open app / open URL / copy to clipboard / translate" bypass the
  // full LLM pipeline entirely and run in < 200ms.
  // Compound actions ("open X, then do Y") intentionally fall through to the
  // normal pipeline so llmPlanner can handle both steps in one tool loop.
  const contextPacket = body.contextPacket ?? { text: body.text ?? "" };
  const fastPath = tryFastPath(userCommand, contextPacket);
  if (fastPath?.tier === 0) {
    return submitActionToolTask({
      userCommand,
      executionMode: body.executionMode ?? "interactive",
      sourceApp: body.sourceApp ?? "uca.http",
      captureMode: body.captureMode ?? "fast_path",
      runtime,
      fastPathTool: fastPath.tool,
      fastPathArgs: fastPath.args,
      background
    });
  }
  // Tier 1 (translation) — handled by specialised executor (future: translation_fast)
  // For now fall through to normal pipeline which will route to translate executor.

  if (body.filePaths?.length) {
    return submitFileTask({
      filePaths: body.filePaths,
      userCommand: body.userCommand,
      captureMode: body.captureMode,
      sourceApp: body.sourceApp,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      background,
      runtime
    });
  }

  if (body.capture?.sourceType) {
    return submitBrowserTask({
      capture: body.capture,
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      background,
      runtime
    });
  }

  if (body.imagePaths?.length) {
    return submitImageTask({
      imagePaths: body.imagePaths,
      userCommand: body.userCommand,
      source: body.source,
      sourceApp: body.sourceApp,
      captureMode: body.captureMode,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride ?? "multi_modal",
      background,
      runtime
    });
  }

  if (body.officeCapture?.officeApp) {
    return submitOfficeTask({
      capture: body.officeCapture,
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      background,
      runtime
    });
  }

  if (body.submissionType === "action_tool") {
    return submitActionToolTask({
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      sourceApp: body.sourceApp,
      captureMode: body.captureMode,
      background,
      runtime
    });
  }

  return submitContextTask({
    contextPacket: body.contextPacket ?? {
      source_type: body.sourceType ?? "clipboard",
      source_app: body.sourceApp ?? "uca.http",
      capture_mode: body.captureMode ?? "manual",
      text: body.text ?? ""
    },
    userCommand: body.userCommand,
    executionMode: body.executionMode,
    executorOverride: body.executorOverride,
    skipDecomposition: Boolean(body.skipDecomposition),
    background,
    runtime
  });
}

async function resumeDagExecution(runtime, executionId) {
  return resumeDagGraph({
    checkpointStore: runtime.platform.dagCheckpointStore,
    executionId,
    async executeNode(node, context) {
      return {
        nodeId: node.id,
        target: node.target ?? node.executor ?? null,
        resumed: true,
        previousCount: Object.keys(context.results ?? {}).length
      };
    }
  });
}

function normalizeScheduleTriggerRequest(trigger = {}) {
  if (trigger.type === "cron") {
    return {
      type: "cron",
      expression: trigger.expression ?? trigger.cron ?? "0 9 * * *",
      timezone: trigger.timezone ?? "Asia/Shanghai"
    };
  }

  if (trigger.type === "interval") {
    return {
      type: "interval",
      seconds: Number(trigger.seconds ?? 60)
    };
  }

  if (trigger.type === "at") {
    const runAt = new Date(trigger.run_at ?? trigger.at ?? "");
    if (Number.isNaN(runAt.getTime())) {
      throw new Error("At schedule trigger requires a valid run_at timestamp.");
    }
    return {
      type: "at",
      run_at: runAt.toISOString(),
      timezone: trigger.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
    };
  }

  return trigger;
}

function buildScheduleActionRequest(body = {}) {
  if (body.action?.type && body.action?.target) {
    return body.action;
  }

  const message = body.message ?? body.userCommand ?? body.command ?? "时间到了";
  return {
    type: "action_tool",
    target: "notify",
    params: {
      title: body.title ?? body.name ?? "UCA 提醒",
      body: message
    }
  };
}

function upsertById(list = [], entry) {
  const index = list.findIndex((item) => item.id === entry.id);
  return index >= 0
    ? list.map((item, itemIndex) => itemIndex === index ? entry : item)
    : [...list, entry];
}

const DEFAULT_PROJECT_ID = "proj_default";
const DEFAULT_PROJECT_COLOR = "#6366f1";

function buildDefaultProjectStore() {
  return {
    currentProjectId: DEFAULT_PROJECT_ID,
    currentConversationId: null,
    projects: [{
      id: DEFAULT_PROJECT_ID,
      name: "默认",
      color: DEFAULT_PROJECT_COLOR,
      createdAt: Date.now(),
      metadata: {}
    }],
    conversations: []
  };
}

function normalizeProjectStore(store) {
  const next = store && typeof store === "object" ? structuredClone(store) : buildDefaultProjectStore();
  next.projects = Array.isArray(next.projects) ? next.projects.filter((project) => project?.id) : [];
  next.conversations = Array.isArray(next.conversations) ? next.conversations.filter((conversation) => conversation?.id) : [];
  if (!next.projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    next.projects.unshift({
      id: DEFAULT_PROJECT_ID,
      name: "默认",
      color: DEFAULT_PROJECT_COLOR,
      createdAt: Date.now(),
      metadata: {}
    });
  }
  next.currentProjectId = next.currentProjectId || DEFAULT_PROJECT_ID;
  next.currentConversationId = next.currentConversationId ?? null;
  return next;
}

function saveRuntimeConfig(runtime, updater) {
  const currentConfig = runtime.configStore?.load?.() ?? {};
  const nextConfig = updater(currentConfig);
  runtime.configStore?.save?.(nextConfig);
  return nextConfig;
}

// Known code CLI signatures: name, common executable names, default args, transport
// The detectable code CLI registry. Binary-name + display-name data for the
// long tail (Qwen, iFlow, CodeBuddy, Goose, Augment, Droid, Copilot, Qoder,
// Vibe, Kiro, Hermes, Snow) is borrowed from iOfficeAI/AionUi's
// `ACP_BACKENDS_ALL` (Apache-2.0) — see THIRD_PARTY_LICENSES.md for
// attribution. We do NOT use their ACP protocol; only the CLI roster.
//
// `defaultModel` is intentionally empty for every entry so the Console's
// task-routing UI starts with "(CLI 自行管理)" selected — users can always
// override with a specific model via the dropdown or custom entry, but no
// hardcoded stale model IDs leak into subprocess arg lists by default.
const KNOWN_CODE_CLIS = [
  // ── Blessed (curated model lists available in console UI) ────────────
  { name: "Kimi Code CLI",  binNames: ["kimi.exe", "kimi"],                                 args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Claude Code",    binNames: ["claude.exe", "claude"],                             args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Codex CLI",      binNames: ["codex.exe", "codex"],                               args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Gemini CLI",     binNames: ["gemini.exe", "gemini"],                             args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Aider",          binNames: ["aider.exe", "aider"],                               args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "OpenCode",       binNames: ["opencode.exe", "opencode"],                         args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Cursor Agent",   binNames: ["cursor-agent.exe", "cursor-agent"],                 args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  // ── Long tail (CLI-managed model by default; roster from AionUi) ─────
  { name: "Qwen Code",      binNames: ["qwen.exe", "qwen"],                                 args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "iFlow CLI",      binNames: ["iflow.exe", "iflow"],                               args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "CodeBuddy",      binNames: ["codebuddy.exe", "codebuddy"],                       args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Goose",          binNames: ["goose.exe", "goose"],                               args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Augment Code",   binNames: ["auggie.exe", "auggie"],                             args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Factory Droid",  binNames: ["droid.exe", "droid"],                               args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "GitHub Copilot", binNames: ["copilot.exe", "copilot"],                           args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Qoder CLI",      binNames: ["qodercli.exe", "qodercli"],                         args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Mistral Vibe",   binNames: ["vibe-acp.exe", "vibe-acp", "vibe.exe", "vibe"],     args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Kiro",           binNames: ["kiro-cli.exe", "kiro-cli"],                         args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Hermes Agent",   binNames: ["hermes.exe", "hermes"],                             args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Snow CLI",       binNames: ["snow.exe", "snow"],                                 args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" }
];

async function findExecutableOnPath(binName) {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(lookup, [binName], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

async function findExecutableInCommonDirs(binName) {
  const home = os.homedir();
  const candidates = process.platform === "win32"
    ? [
        path.join(home, ".local", "bin", binName),
        path.join(home, "AppData", "Local", "Programs", binName.replace(/\.exe$/i, ""), binName),
        path.join(home, "AppData", "Roaming", "npm", binName),
        path.join(home, "scoop", "shims", binName),
        path.join("C:\\Program Files", binName.replace(/\.exe$/i, ""), binName)
      ]
    : [
        path.join(home, ".local", "bin", binName),
        path.join("/usr/local/bin", binName),
        path.join("/opt/homebrew/bin", binName)
      ];

  for (const candidate of candidates) {
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(candidate)) return candidate;
    } catch { /* skip */ }
  }
  return null;
}

async function detectInstalledCodeClis() {
  const found = [];
  for (const cli of KNOWN_CODE_CLIS) {
    let pathFound = null;
    for (const binName of cli.binNames) {
      pathFound = await findExecutableOnPath(binName);
      if (pathFound) break;
      pathFound = await findExecutableInCommonDirs(binName);
      if (pathFound) break;
    }

    if (pathFound) {
      let version = null;
      try {
        const { stdout } = await execFileAsync(pathFound, [cli.versionFlag], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true
        });
        version = stdout.trim().split(/\r?\n/)[0] ?? null;
      } catch { /* version probe failed — still report as found */ }

      found.push({
        name: cli.name,
        command: pathFound,
        args: cli.args,
        transport: cli.transport,
        defaultModel: cli.defaultModel,
        version
      });
    }
  }
  return found;
}

function normalizeModelOption(option) {
  if (typeof option === "string") {
    const id = option.trim();
    return id ? { id, label: id } : null;
  }
  const id = `${option?.id ?? ""}`.trim();
  if (!id) return null;
  return {
    id,
    label: `${option.label ?? id}`.trim() || id
  };
}

function uniqueModelOptions(options = []) {
  const seen = new Set();
  const out = [];
  for (const raw of options) {
    const option = normalizeModelOption(raw);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    out.push(option);
  }
  return out;
}

function providerModelFingerprint(provider = {}) {
  return [
    provider.id,
    provider.name,
    provider.kind,
    provider.baseUrl,
    provider.command,
    provider.defaultModel
  ].map((part) => `${part ?? ""}`.toLowerCase()).join(" ");
}

function codeCliCuratedModelOptions(provider = {}) {
  const fp = providerModelFingerprint(provider);
  const cliManaged = { id: "", label: "(CLI 自行管理)" };
  const preferred = `${provider.defaultModel ?? ""}`.trim()
    ? [{ id: provider.defaultModel, label: `${provider.defaultModel} (保存的默认)` }]
    : [];

  if (/codex/.test(fp)) {
    return uniqueModelOptions([
      cliManaged,
      ...preferred,
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
      { id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
      { id: "gpt-5.2", label: "GPT-5.2" },
      { id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" }
    ]);
  }

  if (/claude/.test(fp)) {
    return uniqueModelOptions([
      cliManaged,
      ...preferred,
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "Opus" },
      { id: "haiku", label: "Haiku" },
      { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5" },
      { id: "claude-opus-4-5", label: "claude-opus-4-5" },
      { id: "claude-haiku-4-5", label: "claude-haiku-4-5" }
    ]);
  }

  if (/(moonshot|kimi)/.test(fp)) {
    return uniqueModelOptions([
      cliManaged,
      ...preferred,
      { id: "kimi-code/kimi-for-coding", label: "Kimi Code" },
      { id: "kimi-k2", label: "K2" },
      { id: "moonshot-v1-128k", label: "Moonshot 128K" }
    ]);
  }

  if (/gemini/.test(fp)) {
    return uniqueModelOptions([
      cliManaged,
      ...preferred,
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }
    ]);
  }

  return uniqueModelOptions([cliManaged, ...preferred]);
}

function apiCuratedModelOptions(provider = {}) {
  const fp = providerModelFingerprint(provider);
  const preferred = `${provider.defaultModel ?? ""}`.trim() ? [provider.defaultModel] : [];
  if (provider.kind === "anthropic") {
    return uniqueModelOptions([...preferred, "claude-sonnet-4-5-20250514", "claude-opus-4-5-20250514", "claude-haiku-4-5-20250514"]);
  }
  if (provider.kind === "ollama") {
    return uniqueModelOptions([...preferred, "llama3.2", "qwen2.5", "mistral", "phi3"]);
  }
  if (/deepseek/.test(fp)) return uniqueModelOptions([...preferred, "deepseek-chat", "deepseek-reasoner"]);
  if (/(moonshot|kimi)/.test(fp)) return uniqueModelOptions([...preferred, "kimi-k2", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]);
  if (/generativelanguage|gemini/.test(fp)) return uniqueModelOptions([...preferred, "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"]);
  return uniqueModelOptions([...preferred, "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-4o", "gpt-4o-mini", "whisper-1"]);
}

function codexReasoningEffortOptions(provider = {}) {
  if (provider.kind !== "code_cli" || !/codex/.test(providerModelFingerprint(provider))) return [];
  return [
    { id: "", label: "(不指定)" },
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra High" }
  ];
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 160)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function resolveProviderModelOptions(provider = {}) {
  const fallback = provider.kind === "code_cli"
    ? codeCliCuratedModelOptions(provider)
    : apiCuratedModelOptions(provider);
  const base = {
    providerId: provider.id ?? null,
    source: "curated",
    dynamic: false,
    models: fallback,
    reasoningEfforts: codexReasoningEffortOptions(provider),
    error: null,
    fetchedAt: new Date().toISOString()
  };

  try {
    if (provider.kind === "ollama") {
      const baseUrl = `${provider.baseUrl ?? "http://127.0.0.1:11434"}`.replace(/\/$/, "");
      const payload = await fetchJsonWithTimeout(`${baseUrl}/api/tags`, {}, 2500);
      const models = uniqueModelOptions((payload.models ?? []).map((model) => model.name));
      if (models.length > 0) {
        return { ...base, source: "ollama_tags", dynamic: true, models: uniqueModelOptions([provider.defaultModel, ...models]) };
      }
    }

    if (provider.kind === "openai" && provider.apiKey && provider.baseUrl) {
      const baseUrl = `${provider.baseUrl}`.replace(/\/$/, "");
      const payload = await fetchJsonWithTimeout(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${provider.apiKey}` }
      });
      const models = uniqueModelOptions((payload.data ?? payload.models ?? []).map((model) => model.id ?? model.name));
      if (models.length > 0) {
        return { ...base, source: "provider_models", dynamic: true, models: uniqueModelOptions([provider.defaultModel, ...models]) };
      }
    }
  } catch (error) {
    return {
      ...base,
      error: error?.name === "AbortError" ? "model_list_timeout" : `${error?.message ?? error}`.slice(0, 240)
    };
  }

  return base;
}

async function runOfficeAddinSetup({ statusOnly = false, elevate = false, resetCache = false } = {}) {
  const scriptPath = path.join(process.cwd(), "scripts", "setup-office-addins.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ];

  if (statusOnly) {
    args.push("-StatusOnly");
  }
  if (elevate) {
    args.push("-Elevate");
  }
  if (resetCache) {
    args.push("-ResetCache");
  }

  const { stdout, stderr } = await execFileAsync("powershell.exe", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: elevate ? 120000 : 30000
  });
  const text = stdout.trim();
  return {
    status: text ? JSON.parse(text) : {},
    stderr: stderr.trim()
  };
}

export function createServiceHttpServer({ runtime, paths, port = 0, host = "127.0.0.1" }) {
  const recentBrowserContexts = [];

  const server = http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const taskEventMatch = url.pathname.match(/^\/task\/([^/]+)\/events$/);
    const taskMatch = url.pathname.match(/^\/task\/([^/]+)$/);
    const cancelMatch = url.pathname.match(/^\/task\/([^/]+)\/cancel$/);
    const retryMatch = url.pathname.match(/^\/task\/([^/]+)\/retry$/);
    const approvalApproveMatch = url.pathname.match(/^\/approvals\/([^/]+)\/approve$/);
    const approvalRejectMatch = url.pathname.match(/^\/approvals\/([^/]+)\/reject$/);
    const scheduleRunsMatch = url.pathname.match(/^\/schedules\/([^/]+)\/runs$/);
    const scheduleMatch = url.pathname.match(/^\/schedules\/([^/]+)$/);
    const templateExportMatch = url.pathname.match(/^\/templates\/([^/]+)\/export$/);
    const templateMatch = url.pathname.match(/^\/templates\/([^/]+)$/);
    const dagExecutionMatch = url.pathname.match(/^\/dag\/executions\/([^/]+)$/);
    const dagResumeMatch = url.pathname.match(/^\/dag\/executions\/([^/]+)\/resume$/);

    // serve office add-in static files
    if (method === "GET" && url.pathname.startsWith("/office/")) {
      const officeAddinDir = path.join(process.cwd(), "office_addin", "shared");
      const fileName = url.pathname.replace(/^\/office\//, "");
      if (fileName && !fileName.includes("..")) {
        try {
          const filePath = path.join(officeAddinDir, fileName);
          const content = await readFile(filePath);
          const ext = path.extname(fileName).toLowerCase();
          const mimeTypes = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
          response.writeHead(200, {
            "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
            "Cache-Control": "no-store, max-age=0"
          });
          response.end(content);
          return;
        } catch { /* file not found — fall through */ }
      }
    }

    try {
      if (method === "GET" && url.pathname === "/config") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, { config });
      }

      if (method === "GET" && url.pathname === "/projects/store") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          store: normalizeProjectStore(config.ui?.projectStore)
        });
      }

      if (method === "POST" && url.pathname === "/projects/store") {
        const body = await readJsonBody(request);
        const store = normalizeProjectStore(body.store ?? body);
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ui: {
            ...(currentConfig.ui ?? {}),
            projectStore: store
          }
        }));
        return sendJson(response, 200, { ok: true, store });
      }

      // Auto-detect installed code CLIs (kimi, claude, codex, gemini, etc.)
      if (method === "GET" && url.pathname === "/config/detect-clis") {
        const detected = await detectInstalledCodeClis();
        return sendJson(response, 200, { clis: detected });
      }

      // List all custom providers
      if (method === "GET" && url.pathname === "/config/providers") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          providers: config.ai?.customProviders ?? [],
          taskRouting: config.ai?.taskRouting ?? {}
        });
      }

      if (method === "GET" && url.pathname === "/config/provider-model-options") {
        const config = runtime.configStore?.load?.() ?? {};
        const providers = config.ai?.customProviders ?? [];
        const providerId = url.searchParams.get("providerId");
        const selected = providerId
          ? providers.filter((provider) => provider.id === providerId)
          : providers;
        const options = {};
        for (const provider of selected) {
          options[provider.id] = await resolveProviderModelOptions(provider);
        }
        return sendJson(response, 200, {
          providerId: providerId ?? null,
          options,
          option: providerId ? options[providerId] ?? null : null
        });
      }

      // Create or update a custom provider
      // body: { id, name, kind, baseUrl, apiKey, command, args, transport, defaultModel }
      if (method === "POST" && url.pathname === "/config/providers") {
        const body = await readJsonBody(request);
        if (!body.id || !body.kind) {
          return sendJson(response, 400, { error: "id and kind required" });
        }
        const config = runtime.configStore?.load?.() ?? {};
        const list = config.ai?.customProviders ?? [];
        const idx = list.findIndex((p) => p.id === body.id);
        const entry = {
          id: body.id,
          name: body.name ?? body.id,
          kind: body.kind,
          defaultModel: body.defaultModel ?? ""
        };
        if (body.kind === "code_cli") {
          entry.command = body.command ?? "";
          entry.args = Array.isArray(body.args) ? body.args : [];
          entry.transport = body.transport ?? "stream_json_print";
        } else {
          entry.baseUrl = body.baseUrl ?? "";
          entry.apiKey = body.apiKey ?? "";
        }
        // configStore.patch deep-merges arrays, so we need to replace the whole list
        // by saving customProviders directly
        const currentConfig = runtime.configStore?.load?.() ?? {};
        const nextList = idx >= 0 ? list.map((p, i) => i === idx ? entry : p) : [...list, entry];
        const nextConfig = {
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            customProviders: nextList
          }
        };
        runtime.configStore?.save?.(nextConfig);
        return sendJson(response, 200, { ok: true, provider: entry });
      }

      // Delete a custom provider by id
      if (method === "DELETE" && url.pathname.startsWith("/config/providers/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/providers\//, ""));
        const config = runtime.configStore?.load?.() ?? {};
        const list = config.ai?.customProviders ?? [];
        const nextList = list.filter((p) => p.id !== id);
        runtime.configStore?.patch?.({ ai: { customProviders: nextList } });
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      // Save task routing — which provider+model+mode handles each task type.
      // body: { chat: {providerId, model, mode}, vision: {providerId, model, mode}, file_analysis: {providerId, model, mode} }
      if (method === "POST" && url.pathname === "/config/routing") {
        const body = await readJsonBody(request);
        runtime.configStore?.patch?.({ ai: { taskRouting: body } });
        return sendJson(response, 200, { ok: true, taskRouting: body });
      }

      // UCA-048: save default output path
      if (method === "POST" && url.pathname === "/config/output") {
        const body = await readJsonBody(request);
        runtime.configStore?.patch?.({ output: { defaultDir: body.defaultDir ?? "", autoCreateDirs: body.autoCreateDirs !== false } });
        return sendJson(response, 200, { ok: true });
      }

      // UCA-048: save feature toggles
      // body: { featureId: { enabled: bool }, ... }
      if (method === "POST" && url.pathname === "/config/features") {
        const body = await readJsonBody(request);
        runtime.configStore?.patch?.({ features: body });
        return sendJson(response, 200, { ok: true });
      }

      if (method === "GET" && url.pathname === "/config/integrations") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          paths: runtime.platform.integrationPaths ?? {},
          mcp: config.ai?.mcp ?? { servers: [] },
          skills: config.ai?.skills ?? { registries: [] },
          codeCli: {
            ...(config.ai?.codeCli ?? {}),
            adapters: config.ai?.codeCli?.adapters ?? []
          },
          email: config.email ?? { accounts: [] }
        });
      }

      if (method === "GET" && url.pathname === "/config/email/accounts") {
        return sendJson(response, 200, {
          accounts: listEmailAccounts(runtime)
        });
      }

      if (method === "GET" && url.pathname === "/config/email/settings") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          settings: config.email?.digest ?? {}
        });
      }

      if (method === "POST" && url.pathname === "/config/email/accounts") {
        const body = await readJsonBody(request);
        if (!body.id || !body.email) {
          return sendJson(response, 400, { error: "id and email required" });
        }
        const account = await upsertEmailAccount(runtime, {
          id: body.id,
          provider: body.provider ?? "imap",
          displayName: body.displayName ?? body.email,
          email: body.email,
          authType: body.authType ?? "password",
          imapHost: body.imapHost ?? "",
          imapPort: body.imapPort ?? 993,
          enabled: body.enabled !== false
        }, body.credentials ?? null);
        return sendJson(response, 200, { ok: true, account });
      }

      if (method === "POST" && url.pathname === "/config/email/settings") {
        const body = await readJsonBody(request);
        const config = runtime.configStore?.load?.() ?? {};
        const nextConfig = {
          ...config,
          email: {
            ...(config.email ?? {}),
            digest: {
              ...(config.email?.digest ?? {}),
              ...body
            }
          }
        };
        runtime.configStore?.save?.(nextConfig);
        return sendJson(response, 200, { ok: true, settings: nextConfig.email.digest });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/email/accounts/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/email\/accounts\//, ""));
        const removed = await deleteEmailAccount(runtime, id);
        return sendJson(response, 200, { ok: true, deleted: id, account: removed });
      }

      if (method === "POST" && url.pathname === "/email/digest/check") {
        const result = await maybeRunMorningDigest({ runtime });
        return sendJson(response, 200, result);
      }

      // UCA-075: Save auto-generated skill from pattern proposal
      if (method === "POST" && url.pathname === "/skills/save") {
        const body = await readJsonBody(request);
        const skillsDir = runtime.paths?.skillsDir ?? null;
        const skillPatternsPath = runtime.paths?.skillPatternsPath ?? null;
        if (!skillsDir) {
          return sendJson(response, 400, { error: "skillsDir not configured" });
        }
        const { patternKey, tools, examples, suggestedId, suggestedName } = body;
        if (!patternKey || !Array.isArray(tools)) {
          return sendJson(response, 400, { error: "patternKey and tools required" });
        }
        const saved = saveAutoSkill(skillPatternsPath, skillsDir, {
          patternKey, tools, examples: examples ?? [], suggestedId, suggestedName
        });
        return sendJson(response, 200, { ok: true, ...saved });
      }

      if (method === "GET" && url.pathname === "/skills/read") {
        const entryPath = resolveSkillEntryPath(runtime, url.searchParams.get("entryPath"));
        if (!entryPath) {
          return sendJson(response, 403, { error: "skill_path_not_allowed" });
        }
        const markdown = await readFile(entryPath, "utf8");
        return sendJson(response, 200, { entryPath, markdown });
      }

      if (method === "POST" && url.pathname === "/skills/write") {
        const body = await readJsonBody(request);
        const entryPath = resolveSkillEntryPath(runtime, body.entryPath);
        if (!entryPath) {
          return sendJson(response, 403, { error: "skill_path_not_allowed" });
        }
        await writeFile(entryPath, `${body.markdown ?? ""}`, "utf8");
        return sendJson(response, 200, { ok: true, entryPath });
      }

      if (method === "POST" && url.pathname === "/config/mcp/servers") {
        const body = await readJsonBody(request);
        if (!body.id) {
          return sendJson(response, 400, { error: "id required" });
        }
        const entry = {
          id: body.id,
          displayName: body.displayName ?? body.name ?? body.id,
          transport: body.transport ?? "stdio",
          command: body.command ?? null,
          args: Array.isArray(body.args) ? body.args : [],
          url: body.url ?? null,
          env: body.env ?? null,
          enabled: body.enabled !== false
        };
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            mcp: {
              ...(currentConfig.ai?.mcp ?? {}),
              servers: upsertById(currentConfig.ai?.mcp?.servers ?? [], entry)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, server: entry });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/mcp/servers/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/mcp\/servers\//, ""));
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            mcp: {
              ...(currentConfig.ai?.mcp ?? {}),
              servers: (currentConfig.ai?.mcp?.servers ?? []).filter((server) => server.id !== id)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      if (method === "POST" && url.pathname === "/config/skills/registries") {
        const body = await readJsonBody(request);
        if (!body.id || !(body.rootPath ?? body.path)) {
          return sendJson(response, 400, { error: "id and rootPath required" });
        }
        const entry = {
          id: body.id,
          displayName: body.displayName ?? body.name ?? body.id,
          rootPath: body.rootPath ?? body.path,
          enabled: body.enabled !== false
        };
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            skills: {
              ...(currentConfig.ai?.skills ?? {}),
              registries: upsertById(currentConfig.ai?.skills?.registries ?? [], entry)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, registry: entry });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/skills/registries/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/skills\/registries\//, ""));
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            skills: {
              ...(currentConfig.ai?.skills ?? {}),
              registries: (currentConfig.ai?.skills?.registries ?? []).filter((registry) => registry.id !== id)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      if (method === "POST" && url.pathname === "/config/code-cli/adapters") {
        const body = await readJsonBody(request);
        if (!body.id || !(body.command ?? body.executable)) {
          return sendJson(response, 400, { error: "id and command required" });
        }
        const entry = {
          id: body.id,
          displayName: body.displayName ?? body.name ?? body.id,
          command: body.command ?? body.executable,
          args: Array.isArray(body.args) ? body.args : [],
          transport: body.transport ?? "stream_json_print",
          defaultModel: body.defaultModel ?? body.model ?? "",
          configFile: body.configFile ?? null,
          mcpConfigFiles: Array.isArray(body.mcpConfigFiles) ? body.mcpConfigFiles : [],
          supportsCheckpointResume: Boolean(body.supportsCheckpointResume)
        };
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            codeCli: {
              ...(currentConfig.ai?.codeCli ?? {}),
              adapters: upsertById(currentConfig.ai?.codeCli?.adapters ?? [], entry)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, adapter: entry });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/code-cli/adapters/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/code-cli\/adapters\//, ""));
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            codeCli: {
              ...(currentConfig.ai?.codeCli ?? {}),
              adapters: (currentConfig.ai?.codeCli?.adapters ?? []).filter((adapter) => adapter.id !== id)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      // Diagnostic: which provider will the next task of the given type hit?
      // Used by Console / Overlay UI so users can verify their routing config
      // is actually in effect, and by scripts/verify-provider-routing.mjs.
      if (method === "GET" && url.pathname === "/ai/active-provider-for-task") {
        const taskType = url.searchParams.get("type") || "chat";
        const { resolveActiveProviderForTask } = await import("../executors/shared/provider-resolver.mjs");
        const active = resolveActiveProviderForTask(taskType, runtime.kimiRuntime);
        return sendJson(response, 200, {
          task_type: taskType,
          descriptor: active.descriptor,
          runtime_source: active.runtime ? "code_cli_subprocess" : (active.descriptor ? "api_provider" : "none")
        });
      }

      if (method === "GET" && url.pathname === "/health") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          ok: true,
          runtime_dir: paths.baseDir,
          db_path: paths.dbPath,
          task_total: runtime.store.listTasks().length,
          kimi: runtime.kimiRuntimeStatus ?? null,
          email: runtime.emailMonitor?.status?.() ?? null,
          config: {
            output: config.output ?? {},
            features: config.features ?? {}
          },
          providers: await runtime.platform.aiProviders.listStatus({
            runtime,
            config
          })
        });
      }

      if (method === "POST" && url.pathname === "/context") {
        const body = await readJsonBody(request);
        const inspection = runtime.securityBroker.inspectContext(body.contextPacket, {
          trigger: "http_context_preview"
        });
        return sendJson(response, 200, inspection);
      }

      if (method === "POST" && url.pathname === "/task") {
        const body = await readJsonBody(request);
        const result = await submitTaskFromBody(runtime, body);
        return sendJson(response, 200, result);
      }

      // UCA-059: /task/clarify — merge original command + clarification answer
      // and resubmit as a normal task (clarificationOf flag skips the ambiguity
      // check so we don't re-trigger the same question in a loop).
      if (method === "POST" && url.pathname === "/task/clarify") {
        const body = await readJsonBody(request);
        const originalCommand = String(body.originalCommand ?? "").trim();
        const clarificationAnswer = String(body.clarificationAnswer ?? "").trim();
        if (!originalCommand || !clarificationAnswer) {
          return sendJson(response, 400, { ok: false, error: "missing_fields", message: "originalCommand and clarificationAnswer are required." });
        }
        // Merge: prepend original command + clarification into a single richer command
        const mergedCommand = `${originalCommand}（补充信息：${clarificationAnswer}）`;
        const mergedBody = {
          ...body,
          userCommand: mergedCommand,
          clarificationOf: originalCommand
        };
        delete mergedBody.originalCommand;
        delete mergedBody.clarificationAnswer;
        const result = await submitTaskFromBody(runtime, mergedBody);
        return sendJson(response, 200, result);
      }

      // ── /echo/kws — local wake-word detection for Echo standby ──
      // The dock sends short rolling mic windows here. sherpa-onnx owns the
      // wake-word decision; Web Speech remains only a fallback when this local
      // path is not configured.
      if (method === "GET" && url.pathname === "/echo/kws/status") {
        return sendJson(response, 200, await getLocalKeywordSpottingStatus());
      }

      if (method === "POST" && url.pathname === "/echo/kws") {
        const contentType = String(request.headers["content-type"] ?? "application/octet-stream").trim();
        let audioBuffer = Buffer.alloc(0);
        let mimeType = "audio/webm";
        if (/^application\/json\b/i.test(contentType)) {
          const body = await readJsonBody(request);
          const audioBase64 = String(body.audio ?? "").replace(/^data:[^;]+;base64,/, "").trim();
          mimeType = String(body.mimeType ?? "audio/webm").trim();
          audioBuffer = audioBase64 ? Buffer.from(audioBase64, "base64") : Buffer.alloc(0);
        } else {
          audioBuffer = await readRawBody(request);
          mimeType = contentType.split(";")[0] || "audio/webm";
        }
        if (audioBuffer.length === 0) {
          return sendJson(response, 400, { ok: false, reason: "missing_audio" });
        }
        if (audioBuffer.length > 1024 * 1024 * 12) {
          return sendJson(response, 413, { ok: false, reason: "audio_too_large" });
        }
        return sendJson(response, 200, await detectWakeKeywordLocally(audioBuffer, { mimeType }));
      }

      // ── /note/transcribe — convert a base64-encoded audio blob to text ──
      // Used by the overlay's "录音笔记" feature to transcribe system audio.
      // Requires an audio-capable provider. Chat-only OpenAI-compatible
      // providers (DeepSeek, most code CLI adapters, etc.) are intentionally
      // not used for audio transcription.
      if (method === "POST" && url.pathname === "/note/transcribe") {
        const contentType = String(request.headers["content-type"] ?? "application/json").trim();
        let audioBuffer = Buffer.alloc(0);
        let mimeType = "audio/webm";
        let lang = String(url.searchParams.get("lang") ?? "auto").trim();

        if (/^application\/json\b/i.test(contentType)) {
          const body = await readJsonBody(request);
          const audioBase64 = String(body.audio ?? "").trim();
          mimeType = String(body.mimeType ?? "audio/webm").trim();
          lang = String(body.lang ?? lang ?? "auto").trim();
          audioBuffer = audioBase64 ? Buffer.from(audioBase64, "base64") : Buffer.alloc(0);
        } else {
          audioBuffer = await readRawBody(request);
          mimeType = contentType.split(";")[0] || "audio/webm";
        }

        if (audioBuffer.length === 0) {
          return sendJson(response, 400, { ok: false, error: "missing_audio" });
        }

        // ── SSE streaming branch ──
        // Used by the overlay voice card so transcribed segments appear
        // progressively instead of the user waiting for a whole-file response.
        // Only local faster-whisper can stream; cloud Whisper is file-in/file-out
        // so we just skip straight to the non-streaming path if local fails.
        if (url.searchParams.get("stream") === "1") {
          response.writeHead(200, SSE_HEADERS);
          response.flushHeaders?.();
          const writeFrame = (obj) => {
            try { response.write(`data: ${JSON.stringify(obj)}\n\n`); }
            catch { /* client hung up */ }
          };
          let closed = false;
          request.on("close", () => { closed = true; });
          const result = await transcribeAudioLocallyStream(
            audioBuffer,
            { mimeType, lang },
            (event) => { if (!closed) writeFrame(event); }
          );
          if (!result.ok && !closed) {
            // Last-ditch: try the non-streaming endpoint (OpenAI Whisper etc.)
            // and emit the full transcript as a single segment. Keeps the UX
            // consistent even when local faster-whisper isn't available.
            const provider = resolveAudioTranscriptionProvider(runtime);
            if (provider) {
              try {
                const formData = new FormData();
                formData.append("file", new Blob([audioBuffer], { type: mimeType }), "note-recording.webm");
                formData.append("model", provider.model || "whisper-1");
                if (lang && lang !== "auto") formData.append("language", lang.split("-")[0]);
                const baseUrl = (provider.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
                const apiResp = await fetch(`${baseUrl}/audio/transcriptions`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${provider.apiKey}` },
                  body: formData
                });
                if (apiResp.ok) {
                  const cloud = await apiResp.json();
                  const text = cloud.text ?? "";
                  if (text) writeFrame({ type: "segment", start: 0, end: 0, text });
                  writeFrame({
                    type: "done",
                    ok: true,
                    transcript: text,
                    provider: providerPublicDescriptor(provider)
                  });
                } else {
                  writeFrame({ type: "error", reason: "api_error", message: "cloud transcription failed" });
                }
              } catch (err) {
                writeFrame({ type: "error", reason: "cloud_exception", message: err.message });
              }
            }
          }
          if (!closed) response.end();
          return;
        }

        const chatProvider = resolveProviderForTask("chat");
        const provider = resolveAudioTranscriptionProvider(runtime);
        if (!provider) {
          const localResult = await transcribeAudioLocally(audioBuffer, { mimeType, lang });
          if (localResult.ok) {
            return sendJson(response, 200, {
              ok: true,
              transcript: localResult.transcript ?? "",
              provider: localResult.provider,
              local: {
                language: localResult.language ?? null,
                language_probability: localResult.language_probability ?? null,
                elapsed_seconds: localResult.elapsed_seconds ?? null,
                device: localResult.device ?? null,
                compute_type: localResult.compute_type ?? null
              }
            });
          }
          return sendJson(response, 200, {
            ok: false,
            transcript: "",
            reason: localResult.reason === "local_transcriber_missing"
              ? "local_transcriber_missing"
              : localResult.reason === "local_transcription_failed"
                ? "local_transcription_failed"
                : "audio_provider_unsupported",
            activeProvider: providerPublicDescriptor(chatProvider),
            detail: localResult.message ?? "",
            message: "The active chat provider does not expose an audio transcription endpoint. Configure UCA_TRANSCRIPTION_API_KEY or add an OpenAI provider for audio transcription."
          });
        }

        try {
          const formData = new FormData();
          formData.append(
            "file",
            new Blob([audioBuffer], { type: mimeType }),
            "note-recording.webm"
          );
          formData.append("model", provider.model || "whisper-1");
          // Language hint is optional. In "auto" mode, omit it so the
          // transcription provider can detect English/Chinese/etc. itself.
          if (lang && lang !== "auto") {
            const langCode = lang.split("-")[0];
            formData.append("language", langCode);
          }

          const baseUrl = (provider.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
          const transcribeUrl = `${baseUrl}/audio/transcriptions`;
          const apiResp = await fetch(transcribeUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${provider.apiKey}` },
            body: formData
          });

          if (!apiResp.ok) {
            const errText = await apiResp.text().catch(() => "");
            const localResult = await transcribeAudioLocally(audioBuffer, { mimeType, lang });
            if (localResult.ok) {
              return sendJson(response, 200, {
                ok: true,
                transcript: localResult.transcript ?? "",
                provider: localResult.provider,
                fallbackFrom: {
                  provider: providerPublicDescriptor(provider),
                  reason: "api_error",
                  detail: errText.slice(0, 200)
                },
                local: {
                  language: localResult.language ?? null,
                  language_probability: localResult.language_probability ?? null,
                  elapsed_seconds: localResult.elapsed_seconds ?? null,
                  device: localResult.device ?? null,
                  compute_type: localResult.compute_type ?? null
                }
              });
            }
            return sendJson(response, 200, {
              ok: false,
              transcript: "",
              reason: "api_error",
              detail: errText.slice(0, 200),
              localReason: localResult.reason ?? null,
              localDetail: localResult.message ?? null
            });
          }

          const result = await apiResp.json();
          return sendJson(response, 200, {
            ok: true,
            transcript: result.text ?? "",
            provider: providerPublicDescriptor(provider)
          });
        } catch (err) {
          const localResult = await transcribeAudioLocally(audioBuffer, { mimeType, lang });
          if (localResult.ok) {
            return sendJson(response, 200, {
              ok: true,
              transcript: localResult.transcript ?? "",
              provider: localResult.provider,
              fallbackFrom: {
                provider: providerPublicDescriptor(provider),
                reason: "transcription_failed",
                detail: err.message
              },
              local: {
                language: localResult.language ?? null,
                language_probability: localResult.language_probability ?? null,
                elapsed_seconds: localResult.elapsed_seconds ?? null,
                device: localResult.device ?? null,
                compute_type: localResult.compute_type ?? null
              }
            });
          }
          return sendJson(response, 200, {
            ok: false,
            transcript: "",
            reason: "transcription_failed",
            detail: err.message,
            localReason: localResult.reason ?? null,
            localDetail: localResult.message ?? null
          });
        }
      }

      if (method === "POST" && url.pathname === "/overlay/handoff") {
        const body = await readJsonBody(request);
        const result = await writeOverlayHandoff(body);
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/page/explain") {
        const body = await readJsonBody(request);
        const result = await handlePageExplain(body);
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/browser/context") {
        const body = await readJsonBody(request);
        const context = normalizeBrowserContextPayload(body);
        const saved = rememberBrowserContext(recentBrowserContexts, context);
        return sendJson(response, 200, { ok: true, context: saved });
      }

      if (method === "GET" && url.pathname === "/browser/context/recent") {
        const contexts = listRecentBrowserContexts(recentBrowserContexts, {
          url: url.searchParams.get("url") ?? "",
          title: url.searchParams.get("title") ?? "",
          limit: url.searchParams.get("limit") ?? "3"
        });
        return sendJson(response, 200, { ok: true, contexts });
      }

      if (method === "GET" && url.pathname === "/setup/office-addins/status") {
        const result = await runOfficeAddinSetup({ statusOnly: true });
        return sendJson(response, 200, result.status);
      }

      if (method === "POST" && url.pathname === "/setup/office-addins") {
        const body = await readJsonBody(request);
        const result = await runOfficeAddinSetup({
          elevate: body.elevate !== false,
          resetCache: body.resetCache === true
        });
        return sendJson(response, 200, result.status);
      }

      if (method === "GET" && url.pathname === "/tasks") {
        return sendJson(response, 200, {
          tasks: listTaskSummaries(runtime)
        });
      }

      if (taskMatch && method === "GET") {
        const payload = summarizeTask(runtime, taskMatch[1]);
        if (!payload) {
          return sendJson(response, 404, { error: "task_not_found" });
        }
        return sendJson(response, 200, payload);
      }

      if (taskEventMatch && method === "GET") {
        const taskId = taskEventMatch[1];
        const task = runtime.store.getTask(taskId);
        if (!task) {
          return sendJson(response, 404, { error: "task_not_found" });
        }

        if (request.headers.accept?.includes("text/event-stream")) {
          const stream = createTaskEventStream({
            store: runtime.store,
            eventBus: runtime.eventBus,
            taskId,
            since: url.searchParams.get("since")
          });
          response.writeHead(200, stream.headers);
          for (const event of stream.replay) {
            response.write(encodeSseFrame(event));
          }
          const unsubscribe = stream.subscribe((event) => {
            response.write(encodeSseFrame(event));
          });
          request.on("close", () => {
            unsubscribe();
            response.end();
          });
          return;
        }

        return sendJson(response, 200, {
          task_id: taskId,
          events: runtime.store.getTaskEventsSince(taskId, url.searchParams.get("since"))
        });
      }

      if (cancelMatch && method === "POST") {
        const task = await cancelTask({
          runtime,
          taskId: cancelMatch[1]
        });
        if (!task) {
          return sendJson(response, 404, { error: "task_not_found" });
        }
        return sendJson(response, 200, { task });
      }

      if (taskMatch && method === "DELETE") {
        const taskId = taskMatch[1];
        const task = runtime.store.getTask(taskId);
        if (!task) {
          return sendJson(response, 404, { error: "task_not_found" });
        }
        runtime.store.deleteTask(taskId);
        return sendJson(response, 200, { deleted: true, task_id: taskId });
      }

      if (retryMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = await retryTask({
          taskId: retryMatch[1],
          runtime,
          mode: body.mode ?? "retry_same",
          overrides: body.overrides ?? {},
          background: body.background === true || body.returnImmediately === true
        });
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/metrics") {
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8"
        });
        response.end(runtime.metrics.renderPrometheus());
        return;
      }

      if (method === "GET" && url.pathname === "/approvals") {
        return sendJson(response, 200, {
          approvals: runtime.pendingApprovals.list()
        });
      }

      if (approvalApproveMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = await runtime.scheduler.approvePendingApproval(approvalApproveMatch[1], body);
        if (!result) {
          return sendJson(response, 404, { error: "approval_not_found" });
        }
        return sendJson(response, 200, result);
      }

      if (approvalRejectMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = runtime.scheduler.rejectPendingApproval(approvalRejectMatch[1], body);
        if (!result) {
          return sendJson(response, 404, { error: "approval_not_found" });
        }
        return sendJson(response, 200, { approval: result });
      }

      if (method === "GET" && url.pathname === "/audit-log") {
        return sendJson(response, 200, {
          entries: runtime.store.listAuditLogs()
        });
      }

      if (method === "GET" && url.pathname === "/security/state") {
        return sendJson(response, 200, {
          security: runtime.securityBroker.getConfig()
        });
      }

      if (method === "POST" && url.pathname === "/security/state") {
        const body = await readJsonBody(request);
        const security = runtime.persistSecurityConfig(body);
        return sendJson(response, 200, { security });
      }

      if (method === "GET" && url.pathname === "/schedules") {
        return sendJson(response, 200, {
          schedules: runtime.scheduler.listSchedules()
        });
      }

      if (method === "POST" && url.pathname === "/schedules") {
        const body = await readJsonBody(request);
        try {
          const trigger = body.trigger?.natural_language
            ? body.trigger
            : normalizeScheduleTriggerRequest(body.trigger ?? {
              type: "cron",
              expression: body.cron ?? "0 9 * * *"
            });
          const action = buildScheduleActionRequest(body);
          const schedule = runtime.scheduler.createSchedule({
            name: body.name ?? "Unnamed schedule",
            description: body.description ?? "",
            trigger,
            action,
            executionMode: body.executionMode ?? "unattended_safe",
            catchupPolicy: body.catchupPolicy ?? body.catchup_policy ?? "skip",
            enabled: body.enabled !== false,
            category: body.category ?? body.metadata?.category ?? "general",
            color: body.color ?? body.metadata?.color ?? null,
            leadTimeMs: body.leadTimeMs ?? body.lead_time_ms ?? null,
            userTodo: Boolean(body.userTodo ?? body.user_todo ?? false),
            metadata: {
              ...(body.metadata ?? {}),
              one_shot: Boolean(body.oneShot ?? body.one_shot ?? trigger.oneShot)
            }
          }, { createdBy: body.createdBy ?? "overlay" });

          // UCA-062: Enrich response with human-readable time info so the overlay
          // can show a meaningful Chinese confirmation without re-parsing client-side.
          const now = new Date();
          let timeInfo = null;
          const sourceText = body.userCommand ?? body.message ?? body.name ?? "";
          if (trigger.type === "at" && trigger.run_at) {
            const diffMs = new Date(trigger.run_at).getTime() - now.getTime();
            timeInfo = {
              ts: trigger.run_at,
              display: new Date(trigger.run_at).toLocaleString("zh-CN", { hour12: false }),
              diffMs,
              relativeLabel: formatRelativeDuration(diffMs)
            };
          } else if (sourceText) {
            timeInfo = parseRelativeTime(sourceText, now);
          }

          return sendJson(response, 200, { schedule, timeInfo });
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }

      if (scheduleMatch && method === "DELETE") {
        const deleted = runtime.scheduler.deleteSchedule(scheduleMatch[1]);
        if (!deleted) {
          return sendJson(response, 404, { error: "schedule_not_found" });
        }
        return sendJson(response, 200, { deleted });
      }

      if (scheduleMatch && method === "PATCH") {
        const body = await readJsonBody(request);
        const schedule = runtime.scheduler.pauseSchedule(scheduleMatch[1], body.enabled !== false);
        if (!schedule) {
          return sendJson(response, 404, { error: "schedule_not_found" });
        }
        return sendJson(response, 200, { schedule });
      }

      if (scheduleRunsMatch && method === "GET") {
        return sendJson(response, 200, {
          schedule_id: scheduleRunsMatch[1],
          runs: runtime.store.listScheduleRuns(scheduleRunsMatch[1])
        });
      }

      if (scheduleRunsMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = await runtime.scheduler.dispatch(scheduleRunsMatch[1], "manual", body.triggerPayload ?? {});
        if (!result) {
          return sendJson(response, 404, { error: "schedule_not_found" });
        }
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/templates") {
        return sendJson(response, 200, {
          templates: runtime.platform.templateRegistry.list()
        });
      }

      if (method === "POST" && url.pathname === "/templates") {
        const body = await readJsonBody(request);
        const result = runtime.platform.templateRegistry.save(body.template ?? body, {
          actor: body.actor ?? "console"
        });
        if (!result.ok) {
          return sendJson(response, 400, result);
        }
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/templates/import") {
        const body = await readJsonBody(request);
        const result = runtime.platform.templateRegistry.import(body.template ?? body.raw ?? body, {
          actor: body.actor ?? "console_import"
        });
        if (!result.ok) {
          return sendJson(response, 400, result);
        }
        return sendJson(response, 200, result);
      }

      if (templateExportMatch && method === "GET") {
        const templateId = decodeURIComponent(templateExportMatch[1]);
        const raw = runtime.platform.templateRegistry.export(templateId);
        if (!raw) {
          return sendJson(response, 404, { error: "template_not_found" });
        }
        return sendJson(response, 200, {
          template_id: templateId,
          raw
        });
      }

      if (templateMatch && method === "GET") {
        const templateId = decodeURIComponent(templateMatch[1]);
        const template = runtime.platform.templateRegistry.get(templateId);
        if (!template) {
          return sendJson(response, 404, { error: "template_not_found" });
        }
        return sendJson(response, 200, { template });
      }

      if (templateMatch && method === "DELETE") {
        const templateId = decodeURIComponent(templateMatch[1]);
        const removed = runtime.platform.templateRegistry.remove(templateId);
        if (!removed) {
          return sendJson(response, 404, { error: "template_not_found_or_builtin" });
        }
        return sendJson(response, 200, {
          removed
        });
      }

      if (method === "POST" && url.pathname === "/templates/validate") {
        const body = await readJsonBody(request);
        const template = normalizeTemplateDocument(body.template ?? body);
        return sendJson(response, 200, {
          template,
          validation: validateTemplateDocument(template)
        });
      }

      if (method === "POST" && url.pathname === "/dag/preview") {
        const body = await readJsonBody(request);
        const graph = body.graph ?? body;
        return sendJson(response, 200, {
          graph,
          validation: validateDagDefinition(graph)
        });
      }

      if (method === "GET" && url.pathname === "/dag/executions") {
        return sendJson(response, 200, {
          executions: runtime.platform.dagCheckpointStore.list()
        });
      }

      if (dagExecutionMatch && method === "GET") {
        const executionId = decodeURIComponent(dagExecutionMatch[1]);
        const execution = runtime.platform.dagCheckpointStore.get(executionId);
        if (!execution) {
          return sendJson(response, 404, { error: "dag_execution_not_found" });
        }
        return sendJson(response, 200, { execution });
      }

      if (dagResumeMatch && method === "POST") {
        const executionId = decodeURIComponent(dagResumeMatch[1]);
        const execution = runtime.platform.dagCheckpointStore.get(executionId);
        if (!execution) {
          return sendJson(response, 404, { error: "dag_execution_not_found" });
        }
        const resumed = await resumeDagExecution(runtime, executionId);
        return sendJson(response, 200, {
          execution: resumed
        });
      }

      if (method === "GET" && url.pathname === "/budget") {
        return sendJson(response, 200, {
          budget: runtime.platform.budgetManager.getState()
        });
      }

      if (method === "POST" && url.pathname === "/budget") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, {
          budget: runtime.platform.budgetManager.setLimits(body.limits ?? body)
        });
      }

      if (method === "POST" && url.pathname === "/history/search") {
        const body = await readJsonBody(request);
        const results = await runtime.platform.embeddingStore.search(body.query ?? "", body.limit ?? 5);
        return sendJson(response, 200, { results });
      }

      if (method === "GET" && url.pathname === "/executors") {
        return sendJson(response, 200, {
          executors: runtime.executorRegistry.list()
        });
      }

      if (method === "GET" && url.pathname === "/ai/providers") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          providers: await runtime.platform.aiProviders.listStatus({
            runtime,
            config
          })
        });
      }

      if (method === "GET" && url.pathname === "/ai/code-cli") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          adapters: await runtime.platform.codeCliAdapters.listStatus({
            runtime,
            config
          })
        });
      }

      if (method === "GET" && url.pathname === "/ai/mcp") {
        return sendJson(response, 200, {
          servers: await runtime.platform.mcpServers.listStatus({
            runtime,
            config: runtime.configStore?.load?.() ?? {}
          })
        });
      }

      // PATCH /ai/mcp/:id/toggle  — enable or disable a builtin MCP server
      if (method === "PATCH" && /^\/ai\/mcp\/[^/]+\/toggle$/.test(url.pathname)) {
        const serverId = decodeURIComponent(url.pathname.replace(/^\/ai\/mcp\//, "").replace(/\/toggle$/, ""));
        const body = await readJsonBody(request);
        const { enabled } = body ?? {};
        const currentConfig = runtime.configStore?.load?.() ?? {};
        const toggles = currentConfig.ai?.mcp?.builtinToggles ?? {};
        toggles[serverId] = { enabled: Boolean(enabled) };
        const updatedConfig = {
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            mcp: {
              ...(currentConfig.ai?.mcp ?? {}),
              builtinToggles: toggles
            }
          }
        };
        runtime.configStore?.save?.(updatedConfig);
        // Also invalidate any cached MCP client connection so it picks up the new state
        try {
          const { disconnectAll } = await import("../ai/mcp/client-bridge.mjs");
          await disconnectAll();
        } catch { /* bridge may not be loaded yet */ }
        return sendJson(response, 200, { ok: true, serverId, enabled: Boolean(enabled) });
      }

      // PATCH /ai/mcp/:id/config  — save env-var config (e.g. Brave API Key)
      if (method === "PATCH" && /^\/ai\/mcp\/[^/]+\/config$/.test(url.pathname)) {
        const serverId = decodeURIComponent(url.pathname.replace(/^\/ai\/mcp\//, "").replace(/\/config$/, ""));
        const body = await readJsonBody(request);
        const { key, value } = body ?? {};
        if (!key) return sendJson(response, 400, { error: "key required" });
        const currentConfig = runtime.configStore?.load?.() ?? {};
        const envOverrides = currentConfig.ai?.mcp?.envOverrides ?? {};
        if (!envOverrides[serverId]) envOverrides[serverId] = {};
        envOverrides[serverId][key] = value ?? "";
        runtime.configStore?.save?.({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            mcp: {
              ...(currentConfig.ai?.mcp ?? {}),
              envOverrides
            }
          }
        });
        return sendJson(response, 200, { ok: true, serverId, key });
      }

      if (method === "GET" && url.pathname === "/ai/skills") {
        return sendJson(response, 200, {
          registries: await runtime.platform.skillRegistries.listStatus({
            runtime,
            config: runtime.configStore?.load?.() ?? {}
          }),
          skills: await runtime.platform.skillRegistries.listSkills({
            runtime,
            config: runtime.configStore?.load?.() ?? {}
          })
        });
      }

      // ── Account Connectors (Microsoft 365 / Google) ───────────────────────

      // GET /connectors/accounts — list status for all account connectors
      if (method === "GET" && url.pathname === "/connectors/accounts") {
        const [ms, goog] = await Promise.all([
          getConnectorStatus(runtime, "microsoft"),
          getConnectorStatus(runtime, "google")
        ]);
        return sendJson(response, 200, { connectors: [ms, goog] });
      }

      // GET /connectors/accounts/:type/config — return non-secret connector config
      if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/config$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        const cfg = loadConnectorConfig(runtime, type);
        return sendJson(response, 200, {
          clientId: cfg.clientId ?? "",
          // never return the secret — just whether it's set
          hasClientSecret: Boolean(cfg.clientSecret)
        });
      }

      // PATCH /connectors/accounts/:type/config — save client_id / client_secret
      if (method === "PATCH" && /^\/connectors\/accounts\/(microsoft|google)\/config$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        const body = await readJsonBody(request);
        const updates = {};
        if (typeof body.clientId === "string") updates.clientId = body.clientId.trim();
        if (typeof body.clientSecret === "string") updates.clientSecret = body.clientSecret.trim();
        saveConnectorConfig(runtime, type, updates);
        return sendJson(response, 200, { ok: true });
      }

      // POST /connectors/accounts/:type/auth/start — kick off OAuth flow
      if (method === "POST" && /^\/connectors\/accounts\/(microsoft|google)\/auth\/start$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        const cfg = loadConnectorConfig(runtime, type);
        if (!cfg.clientId) {
          return sendJson(response, 400, { error: "missing_client_id", message: "先在设置里填写 Client ID。" });
        }
        const result = type === "microsoft"
          ? startMicrosoftAuth(cfg.clientId)
          : startGoogleAuth(cfg.clientId);
        return sendJson(response, 200, result);
      }

      // DELETE /connectors/accounts/:type — disconnect (revoke stored tokens)
      if (method === "DELETE" && /^\/connectors\/accounts\/(microsoft|google)$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        await disconnectAccount(runtime, type);
        return sendJson(response, 200, { ok: true });
      }

      // GET /connectors/accounts/:type/files — list files from OneDrive/Google Drive
      if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/files$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        const q = url.searchParams.get("q") ?? "";
        const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20));
        const result = await listFiles(runtime, type, { limit, query: q });
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      // GET /connectors/accounts/:type/emails — list recent emails
      if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/emails$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        const limit = Math.min(20, Number(url.searchParams.get("limit") ?? 10));
        const result = await listEmails(runtime, type, { limit });
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      // GET /connectors/accounts/:type/calendar — list upcoming events
      if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/calendar$/.test(url.pathname)) {
        const type = url.pathname.split("/")[3];
        const limit = Math.min(20, Number(url.searchParams.get("limit") ?? 10));
        const result = await listCalendarEvents(runtime, type, { limit });
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      // GET /auth/callback — OAuth redirect URI (browser lands here after auth)
      if (method === "GET" && url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (error) {
          return sendHtml(response, 400,
            `<html><body style="font-family:system-ui;padding:40px;text-align:center">
              <h2>❌ 授权失败</h2><p>${error}: ${url.searchParams.get("error_description") ?? ""}</p>
              <p style="color:#888">请关闭此标签页，回到 UCA。</p>
            </body></html>`
          );
        }
        if (!code || !state) {
          return sendHtml(response, 400,
            `<html><body style="font-family:system-ui;padding:40px;text-align:center">
              <h2>❌ 无效回调</h2><p>缺少 code 或 state 参数。</p>
            </body></html>`
          );
        }
        const result = await completeOAuthCallback(runtime, code, state);
        if (result.ok) {
          return sendHtml(response, 200,
            `<html><head><meta charset="utf-8"></head>
            <body style="font-family:system-ui;padding:40px;text-align:center;background:#f5f5f5">
              <div style="max-width:400px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
                <div style="font-size:48px;margin-bottom:16px">✅</div>
                <h2 style="margin:0 0 8px">账户已连接</h2>
                <p style="color:#666;margin:0 0 24px">你的 ${result.type === "microsoft" ? "Microsoft 365" : "Google"} 账户已成功连接到 UCA。</p>
                <p style="color:#888;font-size:13px">可以关闭此标签页了。</p>
              </div>
              <script>setTimeout(()=>window.close(),3000)</script>
            </body></html>`
          );
        }
        return sendHtml(response, 400,
          `<html><body style="font-family:system-ui;padding:40px;text-align:center">
            <h2>❌ Token 交换失败</h2><p>${result.error}</p>
            <p style="color:#888">请关闭此标签页，在 UCA 里重试。</p>
          </body></html>`
        );
      }

      return sendJson(response, 404, {
        error: "not_found",
        path: url.pathname
      });
    } catch (error) {
      return sendJson(response, 500, {
        error: "internal_error",
        message: error.message
      });
    }
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(port, host, resolve));
      const address = server.address();
      return {
        port: typeof address === "object" && address ? address.port : port,
        host
      };
    },
    async stop() {
      if (!server.listening) {
        return;
      }
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    server
  };
}
