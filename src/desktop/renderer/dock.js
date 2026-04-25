const dockButton = document.querySelector("#dockButton");
const clipBadge = document.querySelector("#clipBadge");
const taskBadge = document.querySelector("#taskBadge");
const recordingBadge = document.querySelector("#recordingBadge");
const serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";
let dragDepth = 0;
let clipboardReadyTimer = null;
let noteRecordingActive = false;
let lastRecordingHeartbeat = 0;

function applyNoteRecordingState(payload = {}) {
  noteRecordingActive = Boolean(payload.active);
  if (noteRecordingActive) lastRecordingHeartbeat = Date.now();
  dockButton.classList.toggle("recording", noteRecordingActive);
  if (recordingBadge) recordingBadge.textContent = noteRecordingActive ? "REC" : "";
  dockButton.title = noteRecordingActive
    ? `LingxY · 录音中 ${payload.elapsed ?? ""}`.trim()
    : "LingxY";
  window.__orbApi?.recording?.(noteRecordingActive);
}

window.ucaShell.onNoteRecordingState?.(applyNoteRecordingState);
window.ucaShell.getNoteRecordingState?.().then(applyNoteRecordingState).catch(() => {});

// Self-heal: if the dock thinks a note/voice recording is still active but
// no IPC heartbeat has arrived for 15s, assume the overlay died or forgot
// to send the final active:false and clear the red REC ring ourselves.
// Note mode sends a heartbeat every second while active, so 15s is a safe
// quiet window.
setInterval(() => {
  if (!noteRecordingActive) return;
  if (Date.now() - lastRecordingHeartbeat > 15_000) {
    applyNoteRecordingState({ active: false });
  }
}, 5_000);

/* ═══════════════════════════════════════════════
   ECHO MODE — always-on wake-word detection
   ═══════════════════════════════════════════════ */

// Hybrid recognizer: Web Speech API when available (free, fast, online), with
// a MediaRecorder + /note/transcribe rolling-window fallback when Web Speech
// errors (Electron+Windows often throws `network`/`service-not-allowed`).
// Matches wake-word "linxi" / "林夕" in live transcripts and hands off to
// the overlay's existing voice/note pipeline via uca:echo-wake IPC.

// Wake-word matching accepts common STT variants of "linxi", but standby Echo
// must stay quiet and must not wake from a generic command like "开始录音".
// Keep this list close to plausible "linxi / lingxi" transcriptions.
const WAKE_PHRASES = [
  "linxi", "lin xi", "lin-xi", "lingxi", "ling xi", "lynx",
  "linsee", "lin see", "linsey", "lindsay", "linsy",
  "林夕", "林西", "林氏", "林熙", "林希", "林喜", "林溪", "林犀",
  "林席", "林系", "林细", "林戏", "林昔", "林洗", "林奇", "林起",
  "林其", "林期", "林琪", "林琦", "林齐", "林七", "林息", "林惜",
  "林师", "林施", "林诗", "林医师", "林醫師", "林医生", "林醫生",
  "林戲", "林齊", "林錫", "林襲",
  "琳西", "琳熙", "琳溪", "琳希", "琳奇", "琳琪",
  "灵犀", "灵溪", "灵熙", "灵希", "邻西", "邻熙", "凌溪", "凌西", "凌希",
  "靈犀", "靈溪", "靈熙", "靈希", "鄰西", "鄰熙", "淩溪", "淩西", "淩希",
  "临溪", "临西", "淋溪", "淋西", "零西", "零息", "令西", "令希",
  "臨溪", "臨西"
];
const WAKE_FIRST_CHARS = "林琳凌淩灵靈邻鄰临臨淋零令陵麟";
const WAKE_SECOND_CHARS = "夕西氏熙希喜溪犀席系细細戏戲昔洗袭襲奇起其期琪琦齐齊七息惜稀锡錫晰熹";
const WAKE_REGEX_CN = new RegExp(`[${WAKE_FIRST_CHARS}]\\s*[${WAKE_SECOND_CHARS}]`);
const WAKE_REGEX_LATIN = /\b(?:lin|ling|lyn)[\s-]*(?:xi|see|sey|sy|x)\b|\b(?:lindsay|linsey|linsee|lynx)\b/i;
const NOTE_PHRASES = [
  "开始录音", "開始錄音", "start recording", "开始录制", "開始錄製",
  "开始记录", "開始記錄", "录音笔记", "錄音筆記", "会议记录", "會議記錄",
  "会议纪要", "會議紀要", "meeting notes", "voice note"
];
const WAKE_TRADITIONAL_NORMALIZATION = Object.freeze({
  靈: "灵",
  鄰: "邻",
  臨: "临",
  淩: "凌",
  戲: "戏",
  細: "细",
  襲: "袭",
  齊: "齐",
  錫: "锡",
  領: "领",
  醫: "医",
  師: "师",
  詩: "诗",
  悟: "悟"
});

let echoEnabled = false;
let echoRecognizer = null;
let echoFallbackRecorder = null;
let echoFallbackStream = null;
let echoFallbackChunks = [];
let echoFallbackInterval = null;
let echoRestartTimer = null;
let echoLastSeenText = "";
let echoLastSeenTime = 0;
let echoLastWakeTime = 0;
let echoResultWatchdog = null;
let echoResultCountSinceStart = 0;
let echoUsingFallback = false;
let echoFallbackBusy = false;
let echoPausedForSession = false;
let echoFallbackLastErrorReason = "";
let echoResumeTimer = null;
let echoResumeAttempt = 0;
let echoLocalKwsStatus = null;
let echoLocalKwsStatusAt = 0;
// Simple voice-activity tap: we piggyback an AnalyserNode on the mic stream
// so we can RMS-gate outgoing KWS requests. Sending silence or ambient noise
// to sherpa wastes CPU and produces false-negative "no match" responses that
// the user can misread as "wake detection is broken".
let echoVadContext = null;
let echoVadAnalyser = null;
let echoVadSource = null;
let echoVadData = null;
let echoLastVoiceAt = 0;
// Adaptive noise floor — a rolling estimate of the quiet-ambient RMS so
// VAD_RMS_THRESHOLD auto-scales with the user's actual mic/environment.
// In a very quiet room the floor is ~0.002; in a cafe or with a fan it can
// climb to 0.015. Without adaptation we either false-reject in noisy envs
// (threshold too strict) or waste CPU in quiet rooms (threshold way above
// noise). We keep the LOWER 20th-percentile of recent samples as the floor.
let echoNoiseSamples = [];
let echoCurrentFloor = 0.005;
// Near-miss telemetry — how many KWS attempts have happened recently
// without a match. Used to show a hint after a few silent tries.
let echoKwsAttemptsSinceMatch = 0;
let echoKwsLastHintAt = 0;

// How long two identical transcripts count as "the same utterance". After
// this window elapses, re-saying the wake word will retrigger even if the
// Whisper fallback transcribes it identically. 2.5s is long enough to cover
// a single rolling-window overlap but short enough that a deliberate second
// "linxi" goes through.
const ECHO_DEDUPE_WINDOW_MS = 2500;
const ECHO_MIN_REWAKE_MS = 1500;
const ECHO_RESUME_DELAY_MS = 1200;
const ECHO_LOCAL_KWS_STATUS_TTL_MS = 30_000;
const ECHO_LOCAL_KWS_POLL_MS = 900;
// Slightly finer-grained chunks (500ms) with a larger rolling window (6)
// gives a max 3s audio buffer per KWS request. Previously 700ms × 4 chunks
// could fire with just one 0.7s chunk — way too short for sherpa to match
// a two-syllable wake word.
const ECHO_CHUNK_MS = 500;
const ECHO_LOCAL_KWS_WINDOW_CHUNKS = 6;
// Minimum accumulated audio before firing a KWS request. 1.5s is enough for
// the "lin-xi" utterance with some framing silence; going lower made sherpa
// flaky on the short-word edge cases.
const ECHO_MIN_AUDIO_CHUNKS = 3;
// Absolute floor the adaptive VAD threshold will never go below — even in
// dead silence we shouldn't trust sub-0.004 RMS as signal, that's near the
// ADC noise floor of consumer mics.
const ECHO_VAD_ABS_FLOOR = 0.004;
// Multiplier applied on top of the learned noise floor to decide
// "speech vs ambient". 3× gives enough headroom that a steady ambient hum
// doesn't keep tripping the gate.
const ECHO_VAD_SPEECH_MULTIPLIER = 3;
// How recently voice had to register for us to bother sending audio. Long
// enough that the wake word + a bit of trailing silence always counts.
const ECHO_VAD_WINDOW_MS = 1800;
// Cap on rolling noise samples retained (at 60fps sampling this is ~5s).
const ECHO_NOISE_SAMPLE_CAP = 300;
// If the user appears to be speaking (voice energy detected) but none of
// the recent KWS windows matched, we show a one-shot hint after this many
// attempts so they realize they're being heard but the word isn't matching.
const ECHO_NEAR_MISS_HINT_AFTER = 3;
const ECHO_NEAR_MISS_HINT_COOLDOWN_MS = 15_000;

function normalizeForMatch(text) {
  // Lowercase, collapse whitespace, and strip punctuation so phrases like
  // "Linxi," or "linxi。" still match. Keeps Chinese / Latin letters +
  // digits only — everything else becomes a space.
  return String(text ?? "")
    .toLowerCase()
    .replace(/[靈鄰臨淩戲細襲齊錫領悟]/g, (ch) => WAKE_TRADITIONAL_NORMALIZATION[ch] ?? ch)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text, phrases) {
  const norm = normalizeForMatch(text);
  return phrases.some((p) => norm.includes(normalizeForMatch(p)));
}

function matchesWake(text) {
  if (matchesAny(text, WAKE_PHRASES)) return true;
  // Fuzzy Chinese remains bounded to two-character "lin/ling + xi-like"
  // forms; generic command words never pass this gate.
  if (WAKE_REGEX_CN.test(normalizeForMatch(text))) return true;
  if (WAKE_REGEX_LATIN.test(text)) return true;
  return false;
}

async function onWakeDetected(kind, transcript = "") {
  // Rate-limit to one wake every 1.5 seconds (prevents the same utterance
  // from firing twice across interim+final results or across rolling-window
  // iterations). The old "ignore while restartTimer exists" guard locked
  // us out for 8s at a time, which is why a second "linxi" silently failed.
  const now = Date.now();
  if (now - echoLastWakeTime < ECHO_MIN_REWAKE_MS) {
    console.debug("[echo] wake ignored — within re-wake cooldown");
    return;
  }
  echoLastWakeTime = now;
  echoPausedForSession = true;
  echoKwsAttemptsSinceMatch = 0;  // reset near-miss counter after a good wake
  // A fresh wake replaces any pending session — reclaim the restart timer
  // so we don't have two timers racing, and force the recognizer down
  // before handing mic control to the overlay.
  if (echoRestartTimer) { clearTimeout(echoRestartTimer); echoRestartTimer = null; }
  if (echoResumeTimer) { clearTimeout(echoResumeTimer); echoResumeTimer = null; }
  stopEchoRecognizer();
  // First bubble confirms the wake; second longer-duration bubble tells the
  // user exactly what to do next, since overlay is hidden in echo mode and
  // the user otherwise gets no UI cue that we're now listening for their
  // command. We chain them so the confirmation flashes first, then the
  // guidance stays on screen through the rest of the session window.
  window.ucaShell?.showEchoBubble?.({
    text: kind === "note" ? "🎙 开始录音…" : "🎙 已唤醒",
    kind: "wake",
    durationMs: 1200
  });
  setTimeout(() => {
    if (!echoPausedForSession) return;
    window.ucaShell?.showEchoBubble?.({
      text: kind === "note"
        ? "🎙 正在录音… 按 Ctrl+Enter 结束并总结"
        : "🎙 请说出指令，说完按 Ctrl+Enter 发送",
      kind: "info",
      durationMs: 12_000
    });
  }, 1100);
  window.__orbApi?.echoListening?.(true);
  try {
    await window.ucaShell?.sendEchoWake?.({ kind, transcript });
  } catch (err) {
    console.warn("[echo] wake handoff failed:", err);
  }
  // Fallback restart — if overlay never signals echo-session-end (user walks
  // away mid-sentence, Ctrl+Enter never pressed), reclaim the mic and resume
  // wake-listening after 15 seconds. Gives the user enough time to finish a
  // multi-sentence command; shorter than 20s so re-saying "linxi" soon after
  // still Just Works.
  echoRestartTimer = setTimeout(() => {
    echoRestartTimer = null;
    echoPausedForSession = false;
    window.__orbApi?.echoListening?.(false);
    window.ucaShell?.showEchoBubble?.({
      text: "Echo 会话超时，已恢复监听。再次说「linxi」可重新唤醒",
      kind: "info",
      durationMs: 2400
    });
    scheduleEchoResume({ delayMs: ECHO_RESUME_DELAY_MS, announce: false });
  }, 15_000);
}

function scheduleEchoResume({ delayMs = ECHO_RESUME_DELAY_MS, announce = true } = {}) {
  if (echoResumeTimer) {
    clearTimeout(echoResumeTimer);
    echoResumeTimer = null;
  }
  if (!echoEnabled) return;
  echoResumeAttempt += 1;
  const attempt = echoResumeAttempt;
  echoResumeTimer = setTimeout(() => {
    echoResumeTimer = null;
    if (!echoEnabled || echoPausedForSession || attempt !== echoResumeAttempt) return;
    startEchoRecognizer();
    if (announce) {
      console.debug("[echo] wake listener resumed");
    }
  }, delayMs);
}

function handleEchoTranscript(text, { interim = false } = {}) {
  if (!text) return;
  const now = Date.now();
  // Time-windowed dedupe: the same text within 2.5s is treated as the same
  // utterance (Whisper fallback's rolling window produces overlapping
  // transcripts every 1.5s). After the window elapses, the SAME text is a
  // legitimate new utterance — which is what lets the user say "linxi" a
  // second time and get re-triggered even when the transcription lands on
  // the same characters both times.
  const isRecentDuplicate = text === echoLastSeenText
    && (now - echoLastSeenTime) < ECHO_DEDUPE_WINDOW_MS;
  echoLastSeenText = text;
  echoLastSeenTime = now;

  const wakeMatched = matchesWake(text);
  if (!isRecentDuplicate && wakeMatched) {
    void onWakeDetected(matchesAny(text, NOTE_PHRASES) ? "note" : "voice", text);
    return;
  }
  // Standby Echo is intentionally silent for non-wake speech. Showing raw
  // transcripts here made false positives feel like the assistant had woken.
  if (!interim && text.length > 1) console.debug("[echo] ignored non-wake transcript:", text);
}

async function isEchoLocalKwsReady({ force = false } = {}) {
  const now = Date.now();
  if (!force && echoLocalKwsStatus && now - echoLocalKwsStatusAt < ECHO_LOCAL_KWS_STATUS_TTL_MS) {
    return Boolean(echoLocalKwsStatus.ok);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const resp = await fetch(`${serviceBaseUrl}/echo/kws/status`, { signal: controller.signal });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    echoLocalKwsStatus = await resp.json();
    echoLocalKwsStatusAt = Date.now();
    console.info("[echo] local KWS status:", echoLocalKwsStatus);
    return Boolean(echoLocalKwsStatus?.ok);
  } catch (err) {
    echoLocalKwsStatus = { ok: false, reason: err?.name === "AbortError" ? "timeout" : "unreachable" };
    echoLocalKwsStatusAt = Date.now();
    console.debug("[echo] local KWS status unavailable:", err?.message ?? err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function startEchoRecognizer() {
  stopEchoRecognizer();
  echoResultCountSinceStart = 0;
  const localKwsReady = await isEchoLocalKwsReady();
  if (!echoEnabled || echoPausedForSession) return;
  if (localKwsReady) {
    // Announce which engine Echo is using so the user can distinguish a
    // truly-broken wake from a noise/mic issue. Only fired on first start
    // of a session — subsequent restarts (from session-end, watchdog, etc.)
    // stay quiet.
    if (echoResumeAttempt === 0) {
      window.ucaShell?.showEchoBubble?.({
        text: "Echo: 本地 sherpa-onnx 唤醒词引擎已就绪",
        kind: "info", durationMs: 2200
      });
    }
    await startEchoFallback();
    return;
  }
  if (echoResumeAttempt === 0) {
    window.ucaShell?.showEchoBubble?.({
      text: "Echo: Web Speech 在线识别（本地 KWS 未配置）",
      kind: "info", durationMs: 2200
    });
  }
  startEchoWebSpeechRecognizer();
}

function startEchoWebSpeechRecognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  console.info("[echo] startEchoWebSpeechRecognizer — SpeechRecognition available?", Boolean(Ctor));
  if (!Ctor) {
    console.info("[echo] no local KWS and no Web Speech; Echo cannot listen");
    window.ucaShell?.showEchoBubble?.({
      text: "Echo 语音引擎不可用：请安装 sherpa-onnx 或启用 Web Speech",
      kind: "error",
      durationMs: 3600
    });
    echoEnabled = false;
    applyEchoBadge();
    return;
  }
  try {
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "zh-CN";
    // Ask for up to 3 alternative transcriptions per result. Web Speech in
    // zh-CN mode produces wildly different character choices for the same
    // sound ("linxi" → 林氏 / 琳溪 / 灵犀 …); checking every alternative
    // dramatically improves the odds that one of them matches our wake
    // regex without the user repeating themselves.
    rec.maxAlternatives = 3;
    rec.addEventListener("result", (event) => {
      echoResultCountSinceStart += 1;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        // Walk every alternative, not just [0]. First match wins for wake
        // detection; bubble feedback still uses [0] so users see the
        // "primary" guess the recognizer settled on.
        const primary = r[0]?.transcript ?? "";
        console.debug("[echo] result:", JSON.stringify(primary), "final?", r.isFinal,
          "alts:", r.length);
        let wakeHit = null;
        for (let a = 0; a < r.length; a += 1) {
          const altText = r[a]?.transcript ?? "";
          if (!matchesWake(altText)) continue;
          wakeHit = {
            kind: matchesAny(altText, NOTE_PHRASES) ? "note" : "voice",
            text: altText
          };
          break;
        }
        if (wakeHit) {
          echoLastSeenText = wakeHit.text;
          echoLastSeenTime = Date.now();
          void onWakeDetected(wakeHit.kind, wakeHit.text);
          return;
        }
        handleEchoTranscript(primary, { interim: !r.isFinal });
      }
    });
    rec.addEventListener("error", (event) => {
      const code = event.error ?? "unknown";
      console.warn("[echo] recognizer error:", code);
      // Any error other than plain user-stop should trigger the fallback path
      // — Electron + Windows commonly throws `network` / `service-not-allowed`
      // / `language-not-supported` and once Web Speech hits any of those it
      // tends to keep failing. The local fallback is slower but reliable.
      if (code === "aborted" || code === "no-speech") {
        setTimeout(() => { if (echoEnabled && !echoUsingFallback && !echoPausedForSession) startEchoRecognizer(); }, 400);
      } else if (code === "not-allowed" || code === "audio-capture") {
        window.ucaShell?.showEchoBubble?.({
          text: "❌ 麦克风权限被拒，Echo 无法启动",
          kind: "error", durationMs: 3000
        });
        echoEnabled = false;
        applyEchoBadge();
      } else {
        console.info("[echo] Web Speech failed; trying local KWS due to:", code);
        void isEchoLocalKwsReady({ force: true }).then((ready) => {
          if (ready) void startEchoFallback();
        });
      }
    });
    rec.addEventListener("end", () => {
      console.debug("[echo] recognizer end, results=", echoResultCountSinceStart);
      if (echoEnabled && !echoUsingFallback && !echoPausedForSession) setTimeout(() => startEchoRecognizer(), 200);
    });
    rec.start();
    echoRecognizer = rec;
    // Idle watchdog: Web Speech commonly emits no result while the room is
    // quiet. That is healthy, not a failure. Do not switch to local fallback
    // just because no one has spoken; otherwise Echo falls into /note/transcribe
    // and reports "local transcription unavailable" on machines without local
    // Whisper configured.
    echoResultWatchdog = setTimeout(() => {
      if (echoEnabled && !echoUsingFallback && echoResultCountSinceStart === 0) {
        console.debug("[echo] Web Speech is idle; staying on online recognizer");
      }
    }, 5000);
  } catch (err) {
    console.warn("[echo] recognizer start threw:", err);
    void isEchoLocalKwsReady({ force: true }).then((ready) => {
      if (ready) void startEchoFallback();
    });
  }
}

async function startEchoFallback() {
  stopEchoFallback();
  echoUsingFallback = true;
  // Stop the Web Speech recognizer if it's still around — otherwise both will
  // fight for the mic and neither produces usable output.
  try { echoRecognizer?.abort?.(); } catch { /* ignore */ }
  echoRecognizer = null;
  console.info("[echo] starting local sherpa KWS (MediaRecorder + /echo/kws rolling window)");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!echoEnabled || echoPausedForSession) {
      stream.getTracks().forEach((track) => track.stop());
      echoUsingFallback = false;
      return;
    }
    echoFallbackStream = stream;
    // Tap the raw mic stream for a cheap RMS-based VAD so we only POST to
    // sherpa when there's actually speech in the buffer. MediaRecorder chunks
    // are opus-encoded — decoding them client-side just for energy would be
    // silly, so we tap the PCM stream separately via Web Audio.
    try {
      echoVadContext = new (window.AudioContext || window.webkitAudioContext)();
      echoVadSource = echoVadContext.createMediaStreamSource(stream);
      echoVadAnalyser = echoVadContext.createAnalyser();
      echoVadAnalyser.fftSize = 512;
      echoVadAnalyser.smoothingTimeConstant = 0.3;
      echoVadSource.connect(echoVadAnalyser);
      echoVadData = new Float32Array(echoVadAnalyser.fftSize);
      echoLastVoiceAt = 0;
      echoNoiseSamples = [];
      echoCurrentFloor = ECHO_VAD_ABS_FLOOR;
      const sampleVad = () => {
        if (!echoVadAnalyser) return;
        echoVadAnalyser.getFloatTimeDomainData(echoVadData);
        let sumSq = 0;
        for (let i = 0; i < echoVadData.length; i += 1) sumSq += echoVadData[i] * echoVadData[i];
        const rms = Math.sqrt(sumSq / echoVadData.length);
        // Keep a rolling window of RMS samples; estimate the noise floor as
        // the 20th percentile so transient speech doesn't inflate it.
        // Recomputed every ~0.5s to keep this cheap.
        echoNoiseSamples.push(rms);
        if (echoNoiseSamples.length > ECHO_NOISE_SAMPLE_CAP) echoNoiseSamples.shift();
        if (echoNoiseSamples.length >= 30 && echoNoiseSamples.length % 30 === 0) {
          const sorted = echoNoiseSamples.slice().sort((a, b) => a - b);
          const p20 = sorted[Math.floor(sorted.length * 0.20)];
          echoCurrentFloor = Math.max(ECHO_VAD_ABS_FLOOR, p20);
        }
        const speechThreshold = echoCurrentFloor * ECHO_VAD_SPEECH_MULTIPLIER;
        if (rms >= speechThreshold) echoLastVoiceAt = Date.now();
        if (echoFallbackRecorder) requestAnimationFrame(sampleVad);
      };
      requestAnimationFrame(sampleVad);
    } catch (err) {
      console.debug("[echo] VAD tap setup failed, continuing without gate:", err?.message ?? err);
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    echoFallbackChunks = [];
    recorder.addEventListener("dataavailable", (ev) => {
      if (ev.data?.size > 0) {
        echoFallbackChunks.push(ev.data);
        if (echoFallbackChunks.length > ECHO_LOCAL_KWS_WINDOW_CHUNKS) echoFallbackChunks.shift();
      }
    });
    recorder.start(ECHO_CHUNK_MS);
    echoFallbackRecorder = recorder;
    console.info("[echo] local sherpa KWS enabled");
    echoFallbackInterval = setInterval(async () => {
      // Require a minimum accumulated audio duration — sherpa and CAM++
      // both produce unstable results on <1s clips.
      if (echoFallbackChunks.length < ECHO_MIN_AUDIO_CHUNKS) return;
      if (echoFallbackBusy) return;
      // VAD gate: if nothing crossed the speech threshold recently, don't
      // bother sending. Cuts background-noise false-negatives and noticeably
      // lowers CPU when the user isn't speaking. When the VAD tap failed to
      // initialize (echoVadAnalyser is null), we skip the gate so the system
      // still works, just without the optimization.
      if (echoVadAnalyser && Date.now() - echoLastVoiceAt > ECHO_VAD_WINDOW_MS) return;
      echoFallbackBusy = true;
      const snapshot = echoFallbackChunks.slice();
      const blob = new Blob(snapshot, { type: mimeType });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const resp = await fetch(`${serviceBaseUrl}/echo/kws`, {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: await blob.arrayBuffer(),
          signal: controller.signal,
          keepalive: false
        });
        if (!resp.ok) return;
        const payload = await resp.json();
        if (payload?.ok === false) {
          const reason = payload.reason ?? payload.error ?? "transcribe_failed";
          // Only fall back to Web Speech on *configuration* failures that
          // make the local KWS fundamentally broken. Transient per-request
          // failures ("audio_too_short" when the VAD lets through a brief
          // burst, "kws_failed" if the python process hiccupped, etc.)
          // should NOT invalidate the cache — doing so created a Web
          // Speech ↔ sherpa ping-pong that flooded the console and
          // produced no actual wakes.
          const CONFIG_BROKEN = new Set([
            "sherpa_onnx_missing",
            "sherpa_onnx_import_failed",
            "kws_model_missing",
            "kws_model_incomplete"
          ]);
          if (CONFIG_BROKEN.has(reason)) {
            if (reason !== echoFallbackLastErrorReason) {
              echoFallbackLastErrorReason = reason;
              console.info("[echo] local sherpa KWS unavailable; returning to Web Speech:", reason);
            }
            echoLocalKwsStatus = { ok: false, reason };
            echoLocalKwsStatusAt = Date.now();
            stopEchoFallback();
            if (echoEnabled && !echoPausedForSession) {
              startEchoWebSpeechRecognizer();
            }
          } else {
            console.debug("[echo] local KWS transient no-match:", reason);
          }
          return;
        }
        if (payload?.matched) {
          const keyword = `${payload.keyword ?? "linxi"}`.trim();
          console.info(
            "[echo] local KWS matched:", keyword,
            "personalized:", Boolean(payload.personalized),
            "template:", payload?.template ?? null,
            "wakeFallback:", payload?.wakeFallback ?? null
          );
          echoKwsAttemptsSinceMatch = 0;
          void onWakeDetected("voice", keyword);
        } else {
          // Near-miss accounting: we actually sent audio (VAD passed) but
          // sherpa didn't match. Surfacing this lets the user distinguish
          // "I'm not being heard" from "I'm being heard but mispronouncing".
          echoKwsAttemptsSinceMatch += 1;
          console.info(
            `[echo] KWS no-match — attempt ${echoKwsAttemptsSinceMatch}`,
            "floor≈", echoCurrentFloor.toFixed(4),
            "audioSec:", payload?.audio_seconds ?? "?",
            "personalized:", Boolean(payload?.personalized),
            "template:", payload?.template ?? null,
            "wakeFallback:", payload?.wakeFallback ?? null
          );
          const now = Date.now();
          if (
            echoKwsAttemptsSinceMatch >= ECHO_NEAR_MISS_HINT_AFTER
            && now - echoKwsLastHintAt > ECHO_NEAR_MISS_HINT_COOLDOWN_MS
          ) {
            echoKwsLastHintAt = now;
            echoKwsAttemptsSinceMatch = 0;
            window.ucaShell?.showEchoBubble?.({
              text: "👂 听到你在说话但没匹配唤醒词，试试：linxi（林西）/ 大声点 / 靠近麦克风",
              kind: "info",
              durationMs: 3600
            });
          }
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.debug("[echo] local KWS fetch error:", err?.message ?? err);
        }
      } finally {
        clearTimeout(timer);
        echoFallbackBusy = false;
      }
    }, ECHO_LOCAL_KWS_POLL_MS);
  } catch (err) {
    console.warn("[echo] local KWS mic failed:", err?.name, err?.message ?? err);
    window.ucaShell?.showEchoBubble?.({
      text: `❌ 无法启动麦克风：${err?.message ?? err}`,
      kind: "error", durationMs: 3000
    });
    echoEnabled = false;
    applyEchoBadge();
  }
}

function stopEchoFallback() {
  if (echoFallbackInterval) { clearInterval(echoFallbackInterval); echoFallbackInterval = null; }
  try { echoFallbackRecorder?.stop?.(); } catch { /* ignore */ }
  echoFallbackRecorder = null;
  echoFallbackStream?.getTracks?.().forEach((t) => t.stop());
  echoFallbackStream = null;
  echoFallbackChunks = [];
  echoFallbackLastErrorReason = "";
  echoUsingFallback = false;
  // Tear down the VAD audio graph. AudioContext.close() is async; we don't
  // await it because dock is about to restart and a pending close doesn't
  // block anything.
  try { echoVadSource?.disconnect?.(); } catch { /* ignore */ }
  try { echoVadAnalyser?.disconnect?.(); } catch { /* ignore */ }
  try { void echoVadContext?.close?.(); } catch { /* ignore */ }
  echoVadSource = null;
  echoVadAnalyser = null;
  echoVadContext = null;
  echoVadData = null;
  echoLastVoiceAt = 0;
}

function stopEchoRecognizer() {
  if (echoResultWatchdog) { clearTimeout(echoResultWatchdog); echoResultWatchdog = null; }
  try { echoRecognizer?.abort?.(); } catch { /* ignore */ }
  echoRecognizer = null;
  stopEchoFallback();
  echoLastSeenText = "";
}

function applyEchoBadge() {
  dockButton.classList.toggle("echo-on", echoEnabled);
  dockButton.classList.toggle("echo-listening", echoEnabled);
}

function applyEchoState(enabled) {
  if (echoEnabled === enabled) return;
  echoEnabled = enabled;
  console.info("[echo] applyEchoState →", enabled);
  applyEchoBadge();
  if (enabled) {
    startEchoRecognizer();
  } else {
    echoPausedForSession = false;
    if (echoResumeTimer) { clearTimeout(echoResumeTimer); echoResumeTimer = null; }
    stopEchoRecognizer();
    window.__orbApi?.echoListening?.(false);
    window.ucaShell?.showEchoBubble?.({
      text: "Echo 模式已关闭",
      kind: "info",
      durationMs: 1600
    });
  }
}

// Bootstrap: read current settings, listen for changes.
(async () => {
  try {
    const settings = await window.ucaShell?.getSettings?.();
    if (settings?.echoMode) applyEchoState(true);
  } catch { /* ignore */ }
})();
window.ucaShell?.onSettingsChanged?.((settings) => {
  applyEchoState(Boolean(settings?.echoMode));
});

/* ═══════════════════════════════════════════════
   WAKE-WORD ENROLLMENT — stage 2 personalization
   Record the user saying "linxi" three times, then let the backend run each
   saved sample through sherpa itself. Whisper text is shown only as debug
   feedback; KWS self-check success is what enables personalized thresholds.
   ═══════════════════════════════════════════════ */

let wakeEnrollmentActive = false;

async function recordSingleSample({ durationMs = 2500, mimeType = "audio/webm" } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : mimeType;
    const recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks = [];
    recorder.addEventListener("dataavailable", (ev) => {
      if (ev.data?.size > 0) chunks.push(ev.data);
    });
    return await new Promise((resolve, reject) => {
      const stopTimer = setTimeout(() => {
        try { recorder.stop(); } catch { /* ignore */ }
      }, durationMs);
      recorder.addEventListener("stop", () => {
        clearTimeout(stopTimer);
        if (chunks.length === 0) return reject(new Error("no_audio_captured"));
        resolve(new Blob(chunks, { type }));
      }, { once: true });
      recorder.addEventListener("error", (err) => {
        clearTimeout(stopTimer);
        reject(err?.error ?? err);
      }, { once: true });
      recorder.start();
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

async function runWakeEnrollment({ samples = 3, countdownMs = 1400 } = {}) {
  if (wakeEnrollmentActive) return;
  wakeEnrollmentActive = true;
  // Suspend the echo listener so the mic handoff is clean.
  const wasEnabled = echoEnabled;
  if (wasEnabled) stopEchoRecognizer();
  try {
    window.ucaShell?.showEchoBubble?.({
      text: "🎤 录入唤醒词：听到「开始」后大声清晰念「linxi」",
      kind: "info",
      durationMs: 3200
    });
    await new Promise((r) => setTimeout(r, 3000));

    const saved = [];
    const enrollmentSession = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    for (let i = 1; i <= samples; i += 1) {
      // Two-phase cue: "准备" → short pause → "开始！" + record. User has time
      // to see the first bubble, take a breath, then speak when the second
      // one lights up. Previously the single "请念" bubble appeared and
      // recording started before the user had time to react.
      window.ucaShell?.showEchoBubble?.({
        text: `第 ${i}/${samples} 次 — 准备…`,
        kind: "info",
        durationMs: 1200
      });
      await new Promise((r) => setTimeout(r, countdownMs));
      window.ucaShell?.showEchoBubble?.({
        text: `🎙 开始！请念「linxi」`,
        kind: "wake",
        durationMs: 2500
      });
      let blob;
      try {
        blob = await recordSingleSample({ durationMs: 2500 });
      } catch (err) {
        console.warn("[echo] enrollment record failed:", err);
        window.ucaShell?.showEchoBubble?.({
          text: `❌ 录音失败：${err?.message ?? err}`,
          kind: "error", durationMs: 2800
        });
        return;
      }
      let result;
      try {
        const params = new URLSearchParams({
          sample: String(i),
          session: enrollmentSession
        });
        const resp = await fetch(`${serviceBaseUrl}/echo/enroll-keyword?${params}`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: await blob.arrayBuffer()
        });
        result = await resp.json();
      } catch (err) {
        console.warn("[echo] enrollment upload failed:", err);
        window.ucaShell?.showEchoBubble?.({
          text: `❌ 上传失败：${err?.message ?? err}`,
          kind: "error", durationMs: 2800
        });
        return;
      }
      if (!result?.ok) {
        window.ucaShell?.showEchoBubble?.({
          text: `⚠ 第 ${i} 次保存失败（${result?.reason ?? "unknown"}），请重说`,
          kind: "error", durationMs: 3200
        });
        continue;
      }
      // The backend always saves the raw audio. Whisper is diagnostic only;
      // the sherpa self-check below is the source of truth for whether this
      // sample improves personalized wake behavior.
      const kwsSelfCheck = result.kwsSelfCheck ?? {};
      saved.push({
        transcript: result.transcript ?? "",
        kwsMatched: Boolean(kwsSelfCheck.matched),
        kwsKeyword: kwsSelfCheck.keyword ?? "",
        enrollment: result.enrollment ?? null
      });
      console.info(
        `[echo] enrollment sample ${i} transcribed as:`,
        JSON.stringify(result.transcript ?? ""),
        "kwsMatched:", Boolean(kwsSelfCheck.matched),
        "kwsKeyword:", JSON.stringify(kwsSelfCheck.keyword ?? ""),
        "enrollment:", result.enrollment ?? null
      );
      const heardText = result.transcript && result.transcript.trim()
        ? `听到「${result.transcript}」`
        : "（未听清，跳过此样本）";
      const kwsText = kwsSelfCheck.matched
        ? `KWS 命中「${kwsSelfCheck.keyword || "linxi"}」`
        : "KWS 未命中";
      window.ucaShell?.showEchoBubble?.({
        text: `第 ${i}/${samples} 次：${heardText} · ${kwsText}`,
        kind: kwsSelfCheck.matched ? "info" : "error",
        durationMs: 1800
      });
      await new Promise((r) => setTimeout(r, 600));
    }

    if (saved.length > 0) {
      const finalEnrollment = saved.at(-1)?.enrollment ?? {};
      const matched = finalEnrollment.matchedCount ?? saved.filter((s) => s.kwsMatched).length;
      const total = finalEnrollment.sampleCount ?? saved.length;
      const required = finalEnrollment.requiredMatches ?? 2;
      const enabled = Boolean(finalEnrollment.enabled);
      window.ucaShell?.showEchoBubble?.({
        text: enabled
          ? `✅ 录入有效 · KWS 自检命中 ${matched}/${total}`
          : `⚠ 录入未改善唤醒（命中 ${matched}/${total}，需要 ${required}）请靠近麦克风重录`,
        kind: enabled ? "wake" : "error",
        durationMs: enabled ? 3600 : 5200
      });
      // Clear the cached KWS status so the next start re-queries.
      echoLocalKwsStatus = null;
      echoLocalKwsStatusAt = 0;
    } else {
      window.ucaShell?.showEchoBubble?.({
        text: "未采集到可用样本，请重试",
        kind: "error", durationMs: 2400
      });
    }
  } finally {
    wakeEnrollmentActive = false;
    if (wasEnabled) startEchoRecognizer();
  }
}

window.ucaShell?.onStartWakeEnrollment?.(() => {
  void runWakeEnrollment();
});

// Overlay signals the end of an echo-triggered voice/note session. Resume
// wake-word listening right away instead of waiting for the 20s fallback.
window.ucaShell?.onEchoSessionEnd?.(() => {
  if (echoRestartTimer) { clearTimeout(echoRestartTimer); echoRestartTimer = null; }
  echoPausedForSession = false;
  window.__orbApi?.echoListening?.(false);
  scheduleEchoResume({ delayMs: ECHO_RESUME_DELAY_MS, announce: true });
});

window.ucaShell?.onEchoShortcutWake?.((payload = {}) => {
  if (!echoEnabled) return;
  void onWakeDetected(payload.kind === "note" ? "note" : "voice", payload.transcript || "shortcut");
});

// Last-resort self-heal: if Echo is on, not inside a handed-off session, and
// both recognizers are absent, restart listening. This covers rare renderer
// races where the overlay finishes before the dock receives a clean session
// end or Chromium drops SpeechRecognition after a mic handoff.
setInterval(() => {
  if (!echoEnabled || echoPausedForSession) return;
  if (echoResumeTimer) return;
  if (echoRecognizer || echoUsingFallback) return;
  scheduleEchoResume({ delayMs: 250, announce: false });
}, 3000);

// Right-click anywhere on the dock (not just the button) → ask main to pop
// the native context menu. Listening on window-level is more robust than
// dockButton-only in case transparent padding swallows the event.
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  console.info("[echo] contextmenu → requesting native dock menu");
  window.ucaShell?.showDockMenu?.();
});

// Keyboard escape hatch for toggling Echo: Ctrl+Shift+L inside the dock
// window. Useful as a debug/fallback if the right-click menu isn't showing
// up on the user's machine.
window.addEventListener("keydown", async (event) => {
  const meta = event.ctrlKey || event.metaKey;
  if (meta && event.shiftKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    const current = await window.ucaShell?.getSettings?.();
    const next = !current?.echoMode;
    console.info("[echo] keyboard toggle →", next);
    await window.ucaShell?.setEchoMode?.(next);
  }
});

/* ── clipboard change indicator ── */
window.ucaShell.onClipboardChanged((payload) => {
  dockButton.classList.add("clipboard-ready");
  clipBadge.textContent = payload.preview ?? "Copied";
  window.__orbApi?.pulse();

  clearTimeout(clipboardReadyTimer);
  clipboardReadyTimer = setTimeout(() => {
    dockButton.classList.remove("clipboard-ready");
  }, 8000);
});

/* ── task running indicator ──
   activate orb when any visible task is queued or running. Scheduler/email
   tasks used to be filtered out, which made automatic work look idle.
*/
function isUserTask(task) {
  if (task.hidden === true || task.ui_hidden === true) return false;
  return true;
}

// Adaptive polling: fast while there's an active task (so the orb reflects
// completion quickly), slow when idle to save CPU/battery. Errors back off
// even further so the dock doesn't hammer a dead service.
const POLL_FAST_MS = 1500;
const POLL_IDLE_MS = 5000;
const POLL_ERROR_MS = 10000;
let pollTimer = null;
let lastHadActive = false;
let pollLastErrored = false;

function schedulePoll(delay) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollTaskState, delay);
}

async function pollTaskState() {
  try {
    const resp = await fetch("http://127.0.0.1:4310/tasks/summary?limit=40");
    const data = await resp.json();
    const tasks = data.active ?? data.tasks ?? [];

    // Track oldest active task's age so the orb can switch from "thinking"
    // (first ~6s after submission) to "executing" (actually making progress).
    // This is a UX heuristic — no backend phase reporting required.
    let youngestActiveAgeMs = Infinity;
    const hasActive = tasks.some((t) => {
      if (!isUserTask(t)) return false;
      if (t.status !== "running" && t.status !== "queued" && t.status !== "cancelling") return false;
      const created = new Date(t.created_at).getTime();
      const age = Date.now() - created;
      if (age < youngestActiveAgeMs) youngestActiveAgeMs = age;
      return true;
    });
    if (hasActive) {
      if (!noteRecordingActive) {
        const phase = youngestActiveAgeMs < 6000 ? "thinking" : "executing";
        window.__orbApi?.activate(phase);
      }
    } else {
      if (!noteRecordingActive) window.__orbApi?.deactivate();
    }

    // Task completion count badge removed per user request — orb animation
    // already conveys active/idle state; the number badge was covering other UI.
    taskBadge.textContent = "";
    dockButton.classList.remove("has-completed");
    if (!noteRecordingActive) dockButton.title = "LingxY";

    lastHadActive = hasActive;
    pollLastErrored = false;
    schedulePoll(hasActive ? POLL_FAST_MS : POLL_IDLE_MS);
  } catch {
    // Runtime not ready — back off so we don't spin the CPU retrying every
    // 1.5s during startup or service crashes.
    pollLastErrored = true;
    schedulePoll(POLL_ERROR_MS);
  }
}
pollTaskState();

/* ── window drag support ── */
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;

dockButton.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragMoved = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    dragMoved = true;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    window.ucaShell.moveWindowBy("dock", dx, dy);
  }
});

window.addEventListener("mouseup", () => { isDragging = false; });

/* ── click: single = overlay, double = console ── */
let clickTimer = null;
dockButton.addEventListener("click", () => {
  if (dragMoved) { dragMoved = false; return; }
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    window.ucaShell.showWindow("console");
    return;
  }
  clickTimer = setTimeout(async () => {
    clickTimer = null;
    dockButton.classList.remove("clipboard-ready");
    clearTimeout(clipboardReadyTimer);
    await window.ucaShell.showWindow("overlay");
  }, 260);
});

/* ── file drop support ── */
function collectFilePaths(event) {
  const files = [...(event.dataTransfer?.files ?? [])];
  return window.ucaShell.resolveDroppedFilePaths(files);
}

function hasFilePayload(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

function setDragState(active) {
  dockButton.classList.toggle("dragover", active);
}

function handleDragEnter(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  dragDepth += 1;
  setDragState(true);
}

function handleDragOver(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setDragState(true);
}

function handleDragLeave(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragState(false);
}

async function handleDrop(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  dragDepth = 0;
  setDragState(false);
  window.__orbApi?.pulse();
  const filePaths = collectFilePaths(event);
  if (filePaths.length === 0) {
    await window.ucaShell.notify({ title: "LingxY", body: "No files detected." });
    return;
  }
  const result = await window.ucaShell.submitDroppedFiles(filePaths);
  if (result?.accepted) {
    await window.ucaShell.notify({ title: "LingxY", body: `Received ${result.fileCount} file(s).` });
  }
}

["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
  window.addEventListener(name, (e) => { if (hasFilePayload(e)) e.preventDefault(); });
});

window.addEventListener("dragenter", handleDragEnter);
window.addEventListener("dragover", handleDragOver);
window.addEventListener("dragleave", handleDragLeave);
window.addEventListener("drop", handleDrop);
