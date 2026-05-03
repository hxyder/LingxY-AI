import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { SSE_HEADERS } from "../../events/sse.mjs";
import { resolveProviderForTask } from "../../executors/shared/provider-resolver.mjs";
import { readJsonBody, readRawBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCAL_WHISPER_MODEL = "base";
const DEFAULT_LOCAL_WHISPER_BEAM_SIZE = "5";
const ECHO_AUDIO_ACTORS = ["desktop_shell"];
const NOTE_TRANSCRIBE_ACTORS = ["desktop_overlay"];

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

const WAKE_TEXT_PHRASES = [
  "linxi", "lin xi", "lin-xi", "lingxi", "ling xi", "lynx",
  "linsee", "lin see", "linsey", "lindsay", "linsy",
  "林夕", "林西", "林氏", "林熙", "林希", "林喜", "林溪", "林犀",
  "林席", "林系", "林细", "林戏", "林昔", "林洗", "林奇", "林起",
  "林其", "林期", "林琪", "林琦", "林齐", "林七", "林息", "林惜",
  "林师", "林施", "林诗", "林医师", "林醫師", "林醫生", "林医生",
  "琳西", "琳熙", "琳溪", "琳希", "琳奇", "琳琪",
  "灵犀", "灵溪", "灵熙", "灵希", "邻西", "邻熙", "凌溪", "凌西", "凌希",
  "临溪", "临西", "淋溪", "淋西", "零西", "零息", "令西", "令希"
];
const WAKE_TEXT_FIRST_CHARS = "林琳凌灵邻临淋零令陵麟";
const WAKE_TEXT_SECOND_CHARS = "夕西氏熙希喜溪犀席系细戏昔洗师施诗医醫生奇起其期琪琦齐七息惜稀锡晰熹袭";
const WAKE_TEXT_REGEX_CN = new RegExp(`[${WAKE_TEXT_FIRST_CHARS}]\\s*[${WAKE_TEXT_SECOND_CHARS}]`);
const WAKE_TEXT_REGEX_LATIN = /\b(?:lin|ling|lyn)[\s-]*(?:xi|see|sey|sy|x)\b|\b(?:lindsay|linsey|linsee|lynx)\b/i;
const WAKE_TEXT_TRADITIONAL_NORMALIZATION = Object.freeze({
  靈: "灵",
  鄰: "邻",
  臨: "临",
  淩: "凌",
  醫: "医",
  師: "师",
  詩: "诗",
  戲: "戏",
  細: "细",
  襲: "袭",
  齊: "齐",
  錫: "锡"
});

function normalizeWakeText(text = "") {
  return `${text ?? ""}`
    .toLowerCase()
    .replace(/[靈鄰臨淩醫師詩戲細襲齊錫]/g, (ch) => WAKE_TEXT_TRADITIONAL_NORMALIZATION[ch] ?? ch)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesWakeText(text = "") {
  const norm = normalizeWakeText(text);
  if (!norm) return false;
  if (WAKE_TEXT_PHRASES.some((phrase) => norm.includes(normalizeWakeText(phrase)))) return true;
  if (WAKE_TEXT_REGEX_CN.test(norm)) return true;
  if (WAKE_TEXT_REGEX_LATIN.test(text)) return true;
  return false;
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

async function detectWakeKeywordLocally(audioBuffer, { mimeType = "audio/webm", personalized = false, templateFallback = false } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-echo-kws-"));
  const ext = mimeType.includes("wav") ? ".wav"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? ".mp3"
        : ".webm";
  const audioPath = path.join(tempDir, `echo-window${ext}`);
  try {
    await writeFile(audioPath, audioBuffer);
    const args = [getLocalKeywordSpottingScriptPath(), audioPath];
    if (personalized) args.push("--personalized");
    if (templateFallback) args.push("--template-fallback");
    const { stdout } = await execFileAsync(getPythonCommand(), args, {
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

let cachedEnrollmentKnown = undefined;
let cachedEnrollmentKnownAt = 0;
const ENROLLMENT_CACHE_TTL_MS = 0;
const ENROLLMENT_REQUIRED_SAMPLES = 3;
const ENROLLMENT_REQUIRED_MATCHES = 2;
const ENROLLMENT_SAMPLE_KEYS = ["1", "2", "3"];

function getUserKeywordDir() {
  return path.resolve(process.cwd(), "models", "user-keywords");
}

function getEnrollmentManifestPath() {
  return path.join(getUserKeywordDir(), "enrollment.json");
}

function getPersonalizedKwsProfile() {
  return {
    personalized: true,
    score: process.env.UCA_SHERPA_KWS_KEYWORDS_SCORE_PERSONALIZED ?? "2.0",
    threshold: process.env.UCA_SHERPA_KWS_KEYWORDS_THRESHOLD_PERSONALIZED ?? "0.08",
    maxActivePaths: process.env.UCA_SHERPA_KWS_MAX_ACTIVE_PATHS_PERSONALIZED ?? "8"
  };
}

function summarizeEnrollment(samples = {}) {
  const entries = ENROLLMENT_SAMPLE_KEYS
    .map((key) => samples[key])
    .filter(Boolean);
  const matchedCount = entries.filter((item) => item?.kwsSelfCheck?.matched).length;
  const completed = ENROLLMENT_SAMPLE_KEYS.every((key) => Boolean(samples[key]));
  return {
    sampleCount: entries.length,
    requiredSamples: ENROLLMENT_REQUIRED_SAMPLES,
    matchedCount,
    requiredMatches: ENROLLMENT_REQUIRED_MATCHES,
    completed,
    enabled: completed && matchedCount >= ENROLLMENT_REQUIRED_MATCHES
  };
}

async function readEnrollmentManifest() {
  try {
    const parsed = JSON.parse(await readFile(getEnrollmentManifestPath(), "utf8"));
    return {
      schemaVersion: 1,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
      samples: parsed.samples && typeof parsed.samples === "object" ? parsed.samples : {}
    };
  } catch {
    return { schemaVersion: 1, sessionId: "", samples: {} };
  }
}

async function writeEnrollmentSample({ sessionId = "", sampleKey, savedAudio, transcript, kwsSelfCheck }) {
  const manifest = await readEnrollmentManifest();
  const resetForNewSession = sessionId && manifest.sessionId && manifest.sessionId !== sessionId;
  const samples = resetForNewSession || (sessionId && sampleKey === "1")
    ? {}
    : { ...manifest.samples };
  samples[sampleKey] = {
    sample: sampleKey,
    savedAudio,
    transcript,
    kwsSelfCheck,
    updatedAt: new Date().toISOString()
  };
  const summary = summarizeEnrollment(samples);
  const next = {
    schemaVersion: 1,
    sessionId: sessionId || manifest.sessionId || "",
    updatedAt: new Date().toISOString(),
    profile: getPersonalizedKwsProfile(),
    ...summary,
    samples
  };
  await writeFile(getEnrollmentManifestPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  invalidateEnrollmentCache();
  return next;
}

async function hasUserEnrollment() {
  const now = Date.now();
  if (cachedEnrollmentKnown !== undefined && now - cachedEnrollmentKnownAt < ENROLLMENT_CACHE_TTL_MS) {
    return cachedEnrollmentKnown;
  }
  try {
    const parsed = JSON.parse(await readFile(getEnrollmentManifestPath(), "utf8"));
    cachedEnrollmentKnown = Boolean(parsed?.enabled);
  } catch {
    cachedEnrollmentKnown = false;
  }
  cachedEnrollmentKnownAt = now;
  return cachedEnrollmentKnown;
}

function invalidateEnrollmentCache() {
  cachedEnrollmentKnown = undefined;
  cachedEnrollmentKnownAt = 0;
}

async function transcribeAudioLocally(audioBuffer, { mimeType = "audio/webm", lang = "auto", noVad = false } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-note-audio-"));
  const ext = mimeType.includes("wav") ? ".wav"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? ".mp3"
        : ".webm";
  const audioPath = path.join(tempDir, `note-recording${ext}`);
  try {
    await writeFile(audioPath, audioBuffer);
    const args = [
      getLocalTranscriptionScriptPath(),
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
    ];
    if (noVad) args.push("--no-vad");
    const { stdout } = await execFileAsync(getPythonCommand(), args, {
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

async function transcribeAudioLocallyStream(audioBuffer, { mimeType = "audio/webm", lang = "auto" } = {}, onEvent) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "uca-note-audio-"));
  const ext = mimeType.includes("wav") ? ".wav"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? ".mp3"
        : ".webm";
  const audioPath = path.join(tempDir, `note-recording${ext}`);
  try {
    await writeFile(audioPath, audioBuffer);
    const child = spawn(getPythonCommand(), [
      getLocalTranscriptionScriptPath(),
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

function resolveAudioRuntime(runtime) {
  const injected = runtime?.audio;
  return {
    detectWakeKeywordLocally: typeof injected?.detectWakeKeywordLocally === "function"
      ? injected.detectWakeKeywordLocally
      : detectWakeKeywordLocally,
    transcribeAudioLocally: typeof injected?.transcribeAudioLocally === "function"
      ? injected.transcribeAudioLocally
      : transcribeAudioLocally,
    transcribeAudioLocallyStream: typeof injected?.transcribeAudioLocallyStream === "function"
      ? injected.transcribeAudioLocallyStream
      : transcribeAudioLocallyStream,
    hasUserEnrollment: typeof injected?.hasUserEnrollment === "function"
      ? injected.hasUserEnrollment
      : hasUserEnrollment,
    writeEnrollmentSample: typeof injected?.writeEnrollmentSample === "function"
      ? injected.writeEnrollmentSample
      : writeEnrollmentSample,
    getUserKeywordDir: typeof injected?.getUserKeywordDir === "function"
      ? injected.getUserKeywordDir
      : getUserKeywordDir
  };
}

export async function tryHandleAudioRoute({ request, response, method, url, runtime }) {
  if (method === "GET" && url.pathname === "/echo/kws/status") {
    sendJson(response, 200, await getLocalKeywordSpottingStatus());
    return true;
  }

  if (method === "POST" && url.pathname === "/echo/kws") {
    if (!requireDesktopActor({ request, response, allowedActors: ECHO_AUDIO_ACTORS })) return true;
    const audioRuntime = resolveAudioRuntime(runtime);
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
      sendJson(response, 400, { ok: false, reason: "missing_audio" });
      return true;
    }
    if (audioBuffer.length > 1024 * 1024 * 12) {
      sendJson(response, 413, { ok: false, reason: "audio_too_large" });
      return true;
    }

    const personalized = await audioRuntime.hasUserEnrollment();
    const result = await audioRuntime.detectWakeKeywordLocally(audioBuffer, {
      mimeType,
      personalized,
      templateFallback: process.env.UCA_ECHO_TEMPLATE_WAKE_FALLBACK !== "0"
    });
    if (
      result?.ok
      && !result.matched
      && result.audio_seconds >= Number(process.env.UCA_ECHO_WHISPER_WAKE_MIN_SECONDS ?? 1.2)
      && process.env.UCA_ECHO_WHISPER_WAKE_FALLBACK !== "0"
    ) {
      const localWake = await audioRuntime.transcribeAudioLocally(audioBuffer, { mimeType, lang: "zh", noVad: true });
      const transcript = `${localWake.transcript ?? ""}`.trim();
      result.wakeFallback = {
        engine: "local-whisper-wake-fallback",
        ok: Boolean(localWake.ok),
        matched: matchesWakeText(transcript),
        transcript,
        language: localWake.language ?? null,
        model: localWake.provider?.model ?? localWake.model ?? null,
        reason: localWake.reason ?? null
      };
      if (result.wakeFallback.matched) {
        result.matched = true;
        result.keyword = transcript || "linxi";
        result.events = [
          ...(Array.isArray(result.events) ? result.events : []),
          {
            keyword: result.keyword,
            engine: result.wakeFallback.engine,
            transcript
          }
        ];
      }
    }
    result.personalized = personalized;
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/echo/enroll-keyword") {
    if (!requireDesktopActor({ request, response, allowedActors: ECHO_AUDIO_ACTORS })) return true;
    const audioRuntime = resolveAudioRuntime(runtime);
    const contentType = String(request.headers["content-type"] ?? "application/octet-stream").trim();
    const sampleIndex = String(url.searchParams.get("sample") ?? "").trim();
    const sessionId = String(url.searchParams.get("session") ?? "").trim();
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
      sendJson(response, 400, { ok: false, reason: "missing_audio" });
      return true;
    }

    const userKwDir = audioRuntime.getUserKeywordDir();
    await mkdir(userKwDir, { recursive: true });
    const local = await audioRuntime.transcribeAudioLocally(audioBuffer, { mimeType, lang: "zh", noVad: true });
    const transcript = (local.transcript ?? "").trim();
    const ext = mimeType.includes("wav") ? ".wav" : ".webm";
    const stamp = Date.now();
    const baseName = sampleIndex
      ? `sample-${String(sampleIndex).padStart(2, "0")}`
      : `sample-${stamp}`;
    const savedAudio = `${baseName}${ext}`;
    await writeFile(path.join(userKwDir, savedAudio), audioBuffer);

    const kwsResult = await audioRuntime.detectWakeKeywordLocally(audioBuffer, { mimeType, personalized: true });
    const kwsSelfCheck = {
      ok: Boolean(kwsResult?.ok),
      matched: Boolean(kwsResult?.matched),
      keyword: kwsResult?.keyword ?? "",
      audio_seconds: kwsResult?.audio_seconds ?? null,
      reason: kwsResult?.reason ?? null,
      message: kwsResult?.message ?? null,
      profile: getPersonalizedKwsProfile()
    };
    const sampleKey = sampleIndex || `${stamp}`;
    const enrollment = await audioRuntime.writeEnrollmentSample({
      sessionId,
      sampleKey,
      savedAudio,
      transcript,
      kwsSelfCheck
    });

    sendJson(response, 200, {
      ok: true,
      transcript,
      transcriptAddedToKeywords: false,
      sample: sampleIndex,
      savedAudio,
      kwsSelfCheck,
      enrollment: {
        enabled: enrollment.enabled,
        completed: enrollment.completed,
        matchedCount: enrollment.matchedCount,
        sampleCount: enrollment.sampleCount,
        requiredMatches: enrollment.requiredMatches,
        requiredSamples: enrollment.requiredSamples,
        profile: enrollment.profile
      }
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/note/transcribe") {
    if (!requireDesktopActor({ request, response, allowedActors: NOTE_TRANSCRIBE_ACTORS })) return true;
    const audioRuntime = resolveAudioRuntime(runtime);
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
      sendJson(response, 400, { ok: false, error: "missing_audio" });
      return true;
    }

    if (url.searchParams.get("stream") === "1") {
      response.writeHead(200, SSE_HEADERS);
      response.flushHeaders?.();
      const writeFrame = (obj) => {
        try { response.write(`data: ${JSON.stringify(obj)}\n\n`); }
        catch { /* client hung up */ }
      };
      let closed = false;
      request.on("close", () => { closed = true; });

      let providerHandled = false;
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
            if (!closed && text) writeFrame({ type: "segment", start: 0, end: 0, text });
            if (!closed) {
              writeFrame({
                type: "done",
                ok: true,
                transcript: text,
                provider: providerPublicDescriptor(provider)
              });
            }
            providerHandled = true;
          }
        } catch {
          providerHandled = false;
        }
      }

      if (!providerHandled && !closed) {
        const result = await audioRuntime.transcribeAudioLocallyStream(
          audioBuffer,
          { mimeType, lang },
          (event) => { if (!closed) writeFrame(event); }
        );
        if (!result.ok && !closed) {
          writeFrame({ type: "error", reason: result.reason ?? "local_stream_failed" });
        }
      }
      if (!closed) response.end();
      return true;
    }

    const chatProvider = resolveProviderForTask("chat");
    const provider = resolveAudioTranscriptionProvider(runtime);
    if (!provider) {
      const localResult = await audioRuntime.transcribeAudioLocally(audioBuffer, { mimeType, lang });
      if (localResult.ok) {
        sendJson(response, 200, {
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
        return true;
      }
      sendJson(response, 200, {
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
      return true;
    }

    try {
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([audioBuffer], { type: mimeType }),
        "note-recording.webm"
      );
      formData.append("model", provider.model || "whisper-1");
      if (lang && lang !== "auto") {
        formData.append("language", lang.split("-")[0]);
      }

      const baseUrl = (provider.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const apiResp = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        body: formData
      });

      if (!apiResp.ok) {
        const errText = await apiResp.text().catch(() => "");
        const localResult = await audioRuntime.transcribeAudioLocally(audioBuffer, { mimeType, lang });
        if (localResult.ok) {
          sendJson(response, 200, {
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
          return true;
        }
        sendJson(response, 200, {
          ok: false,
          transcript: "",
          reason: "api_error",
          detail: errText.slice(0, 200),
          localReason: localResult.reason ?? null,
          localDetail: localResult.message ?? null
        });
        return true;
      }

      const result = await apiResp.json();
      sendJson(response, 200, {
        ok: true,
        transcript: result.text ?? "",
        provider: providerPublicDescriptor(provider)
      });
      return true;
    } catch (err) {
      const localResult = await audioRuntime.transcribeAudioLocally(audioBuffer, { mimeType, lang });
      if (localResult.ok) {
        sendJson(response, 200, {
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
        return true;
      }
      sendJson(response, 200, {
        ok: false,
        transcript: "",
        reason: "transcription_failed",
        detail: err.message,
        localReason: localResult.reason ?? null,
        localDetail: localResult.message ?? null
      });
      return true;
    }
  }

  return false;
}
