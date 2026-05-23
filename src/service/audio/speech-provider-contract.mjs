import {
  resolveLocalSpeechRuntime,
  summarizeLocalSpeechRuntime
} from "./local-speech-runtime.mjs";
import { hydrateProviderApiKeySecretSync } from "../security/secret-store.mjs";

export const SPEECH_PROVIDER_CONTRACT_SCHEMA_VERSION = 1;

export const SPEECH_PROVIDER_KIND = Object.freeze({
  OPENAI_COMPATIBLE_STT: "openai_compatible_stt",
  LOCAL_FASTER_WHISPER_STT: "local_faster_whisper_stt",
  LOCAL_SHERPA_KWS: "local_sherpa_kws",
  OS_NATIVE_TTS: "os_native_tts"
});

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

export function providerSupportsAudioTranscription(provider = {}) {
  if (provider.kind !== "openai" || !provider.apiKey) return false;
  if (provider.audioTranscription === true || provider.capabilities?.audioTranscription === true) return true;
  return isOfficialOpenAIBaseUrl(provider.baseUrl);
}

export function providerPublicDescriptor(provider = null) {
  if (!provider) return null;
  return {
    id: provider.configId ?? provider.id ?? null,
    kind: provider.kind ?? null,
    speechKind: provider.speechKind ?? null,
    name: provider.providerName ?? provider.name ?? null,
    baseUrl: provider.baseUrl ?? null,
    model: provider.model ?? provider.defaultModel ?? null
  };
}

export function pickAudioTranscriptionModel(provider = {}, fallback = "whisper-1") {
  const explicit = provider.audioTranscriptionModel || provider.transcriptionModel;
  if (explicit) return explicit;
  const defaultModel = `${provider.defaultModel ?? ""}`.trim();
  if (defaultModel === "whisper-1" || /transcribe/u.test(defaultModel)) return defaultModel;
  return fallback;
}

export function resolveAudioTranscriptionProvider(runtime, env = process.env) {
  const envKey = readApiKey(env, "UCA_TRANSCRIPTION_API_KEY", "OPENAI_API_KEY", "UCA_OPENAI_API_KEY");
  if (envKey) {
    return {
      id: "openai",
      configId: "audio-env",
      kind: "openai",
      speechKind: SPEECH_PROVIDER_KIND.OPENAI_COMPATIBLE_STT,
      apiKey: envKey,
      baseUrl: env.UCA_TRANSCRIPTION_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.UCA_TRANSCRIPTION_MODEL ?? "whisper-1",
      providerName: "OpenAI-compatible transcription (env)"
    };
  }

  const config = runtime?.configStore?.load?.() ?? {};
  const secretOptions = {
    secretStore: runtime?.secretStore ?? null,
    paths: runtime?.paths ?? null,
    configPath: runtime?.configStore?.configPath ?? null
  };
  const providers = (config.ai?.customProviders ?? [])
    .map((provider) => hydrateProviderApiKeySecretSync(provider, secretOptions));
  const audioRoute = config.ai?.taskRouting?.audio_transcription;
  if (audioRoute?.providerId) {
    const routed = providers.find((provider) => provider.id === audioRoute.providerId);
    if (providerSupportsAudioTranscription(routed)) {
      return {
        id: "openai",
        configId: routed.id,
        kind: routed.kind,
        speechKind: SPEECH_PROVIDER_KIND.OPENAI_COMPATIBLE_STT,
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
    speechKind: SPEECH_PROVIDER_KIND.OPENAI_COMPATIBLE_STT,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: pickAudioTranscriptionModel(provider),
    providerName: provider.name
  };
}

export function buildSpeechProviderStatus(runtime, env = process.env) {
  const cloudProvider = resolveAudioTranscriptionProvider(runtime, env);
  const localSpeech = summarizeLocalSpeechRuntime(resolveLocalSpeechRuntime({ env }));
  const ttsConfig = runtime?.configStore?.load?.()?.echo?.tts ?? {};

  return {
    schemaVersion: SPEECH_PROVIDER_CONTRACT_SCHEMA_VERSION,
    stt: [
      {
        id: "cloud-openai-compatible",
        kind: SPEECH_PROVIDER_KIND.OPENAI_COMPATIBLE_STT,
        configured: Boolean(cloudProvider),
        provider: providerPublicDescriptor(cloudProvider)
      },
      {
        id: "local-faster-whisper",
        kind: SPEECH_PROVIDER_KIND.LOCAL_FASTER_WHISPER_STT,
        configured: Boolean(localSpeech.localWhisper.scriptAvailable),
        model: localSpeech.localWhisper.model,
        modelSource: localSpeech.localWhisper.modelSource,
        modelAvailable: localSpeech.localWhisper.modelAvailable,
        runtime: localSpeech.localWhisper
      }
    ],
    kws: [
      {
        id: "local-sherpa-onnx-kws",
        kind: SPEECH_PROVIDER_KIND.LOCAL_SHERPA_KWS,
        configured: Boolean(localSpeech.sherpaKws.scriptAvailable),
        modelDir: localSpeech.sherpaKws.modelDir,
        modelSource: localSpeech.sherpaKws.modelSource,
        modelAvailable: localSpeech.sherpaKws.modelAvailable,
        runtime: localSpeech.sherpaKws
      }
    ],
    tts: [
      {
        id: "os-native-tts",
        kind: SPEECH_PROVIDER_KIND.OS_NATIVE_TTS,
        configured: ttsConfig.enabled !== false,
        maxChars: Number.isFinite(Number(ttsConfig.maxChars)) ? Number(ttsConfig.maxChars) : null,
        voice: typeof ttsConfig.voice === "string" && ttsConfig.voice.trim() ? ttsConfig.voice.trim() : null
      }
    ],
    localRuntime: localSpeech
  };
}

export function resolveAudioTranscriptionStatus(runtime, env = process.env) {
  const provider = resolveAudioTranscriptionProvider(runtime, env);
  const speechProviders = buildSpeechProviderStatus(runtime, env);
  const localWhisper = speechProviders.stt.find((entry) => entry.id === "local-faster-whisper");
  return {
    ok: Boolean(provider),
    provider: providerPublicDescriptor(provider),
    model: provider?.model ?? null,
    localFallback: {
      available: Boolean(localWhisper?.configured),
      model: localWhisper?.model ?? null,
      device: env.UCA_LOCAL_WHISPER_DEVICE || "cpu",
      computeType: env.UCA_LOCAL_WHISPER_COMPUTE_TYPE || "int8",
      runtime: speechProviders.localRuntime
    },
    providers: speechProviders,
    reason: provider ? null : "audio_provider_unconfigured"
  };
}

export async function transcribeWithOpenAiCompatibleProvider({
  provider,
  audioBuffer,
  mimeType = "audio/webm",
  fileName = "note-recording.webm",
  lang = "auto",
  prompt = "",
  fetchImpl = globalThis.fetch
} = {}) {
  if (!provider?.apiKey) {
    return { ok: false, reason: "provider_missing_api_key", detail: "" };
  }
  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, reason: "missing_audio", detail: "" };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "fetch_unavailable", detail: "" };
  }

  try {
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
    formData.append("model", provider.model || "whisper-1");
    if (lang && lang !== "auto") formData.append("language", lang.split("-")[0]);
    if (prompt) formData.append("prompt", prompt);
    const baseUrl = (provider.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const apiResp = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: formData
    });
    if (!apiResp.ok) {
      const detail = await apiResp.text().catch(() => "");
      return { ok: false, reason: "api_error", detail: detail.slice(0, 200), status: apiResp.status };
    }
    return { ok: true, result: await apiResp.json() };
  } catch (error) {
    return {
      ok: false,
      reason: "transcription_failed",
      detail: error?.message ?? String(error)
    };
  }
}
