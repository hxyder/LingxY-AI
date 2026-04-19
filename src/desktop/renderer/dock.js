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
    ? `UCA · 录音中 ${payload.elapsed ?? ""}`.trim()
    : "UCA";
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

// How long two identical transcripts count as "the same utterance". After
// this window elapses, re-saying the wake word will retrigger even if the
// Whisper fallback transcribes it identically. 2.5s is long enough to cover
// a single rolling-window overlap but short enough that a deliberate second
// "linxi" goes through.
const ECHO_DEDUPE_WINDOW_MS = 2500;
const ECHO_MIN_REWAKE_MS = 1500;
const ECHO_RESUME_DELAY_MS = 1200;

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
  // A fresh wake replaces any pending session — reclaim the restart timer
  // so we don't have two timers racing, and force the recognizer down
  // before handing mic control to the overlay.
  if (echoRestartTimer) { clearTimeout(echoRestartTimer); echoRestartTimer = null; }
  if (echoResumeTimer) { clearTimeout(echoResumeTimer); echoResumeTimer = null; }
  stopEchoRecognizer();
  window.ucaShell?.showEchoBubble?.({
    text: kind === "note" ? "🎙 开始录音…" : "🎙 已唤醒，请说",
    kind: "wake",
    durationMs: 1400
  });
  window.__orbApi?.echoListening?.(true);
  try {
    await window.ucaShell?.sendEchoWake?.({ kind, transcript });
  } catch (err) {
    console.warn("[echo] wake handoff failed:", err);
  }
  // Fallback restart — if overlay never signals echo-session-end (user walks
  // away mid-sentence, Ctrl+Enter never pressed), reclaim the mic and resume
  // wake-listening after 8 seconds. Short enough that re-saying "linxi" a
  // few seconds later Just Works.
  echoRestartTimer = setTimeout(() => {
    echoRestartTimer = null;
    echoPausedForSession = false;
    window.__orbApi?.echoListening?.(false);
    scheduleEchoResume({ delayMs: ECHO_RESUME_DELAY_MS, announce: false });
  }, 8_000);
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

function startEchoRecognizer() {
  stopEchoRecognizer();
  echoResultCountSinceStart = 0;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  console.info("[echo] startEchoRecognizer — SpeechRecognition available?", Boolean(Ctor));
  if (!Ctor) {
    console.info("[echo] no Web Speech, going straight to local fallback");
    startEchoFallback();
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
        console.info("[echo] switching to local fallback due to:", code);
        startEchoFallback();
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
    startEchoFallback();
  }
}

async function startEchoFallback() {
  stopEchoFallback();
  echoUsingFallback = true;
  // Stop the Web Speech recognizer if it's still around — otherwise both will
  // fight for the mic and neither produces usable output.
  try { echoRecognizer?.abort?.(); } catch { /* ignore */ }
  echoRecognizer = null;
  console.info("[echo] starting local fallback (MediaRecorder + /note/transcribe rolling window)");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    echoFallbackStream = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    echoFallbackChunks = [];
    recorder.addEventListener("dataavailable", (ev) => {
      if (ev.data?.size > 0) {
        echoFallbackChunks.push(ev.data);
        if (echoFallbackChunks.length > 5) echoFallbackChunks.shift();
      }
    });
    recorder.start(1000);
    echoFallbackRecorder = recorder;
    console.info("[echo] local fallback enabled");
    echoFallbackInterval = setInterval(async () => {
      if (echoFallbackChunks.length === 0) return;
      // Skip if the previous request hasn't finished — prevents overlapping
      // POSTs (which Chromium logs as "OnSizeReceived failed Error:-2" when
      // one gets cancelled). Also skip if the server is clearly slow.
      if (echoFallbackBusy) return;
      echoFallbackBusy = true;
      const snapshot = echoFallbackChunks.slice();
      const blob = new Blob(snapshot, { type: mimeType });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const resp = await fetch(`${serviceBaseUrl}/note/transcribe?lang=zh`, {
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
          if (reason !== echoFallbackLastErrorReason) {
            echoFallbackLastErrorReason = reason;
            console.debug("[echo] local fallback unavailable; returning to online recognizer:", reason);
          }
          stopEchoFallback();
          if (echoEnabled && !echoPausedForSession) {
            scheduleEchoResume({ delayMs: 500, announce: false });
          }
          return;
        }
        const text = `${payload.transcript ?? ""}`.trim();
        if (text) console.debug("[echo] fallback transcript:", JSON.stringify(text));
        handleEchoTranscript(text);
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.debug("[echo] fallback fetch error:", err?.message ?? err);
        }
      } finally {
        clearTimeout(timer);
        echoFallbackBusy = false;
      }
    }, 1500);
  } catch (err) {
    console.warn("[echo] fallback mic failed:", err?.name, err?.message ?? err);
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
   activate orb when any non-schedule task is queued or running
   deactivate when nothing's left
*/
function isUserTask(task) {
  // exclude scheduler-triggered background tasks
  if (task.source_app === "uca.scheduler") return false;
  if (task.capture_mode === "scheduler") return false;
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
    const resp = await fetch("http://127.0.0.1:4310/tasks");
    const data = await resp.json();
    const tasks = data.tasks ?? [];
    const twoMinAgo = Date.now() - 2 * 60 * 1000;

    // Track oldest active task's age so the orb can switch from "thinking"
    // (first ~6s after submission) to "executing" (actually making progress).
    // This is a UX heuristic — no backend phase reporting required.
    let youngestActiveAgeMs = Infinity;
    const hasActive = tasks.some((t) => {
      if (!isUserTask(t)) return false;
      if (t.status !== "running" && t.status !== "queued" && t.status !== "cancelling") return false;
      const created = new Date(t.created_at).getTime();
      if (!(Number.isFinite(created) && created > twoMinAgo)) return false;
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
    if (!noteRecordingActive) dockButton.title = "UCA";

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
    await window.ucaShell.notify({ title: "UCA", body: "No files detected." });
    return;
  }
  const result = await window.ucaShell.submitDroppedFiles(filePaths);
  if (result?.accepted) {
    await window.ucaShell.notify({ title: "UCA", body: `Received ${result.fileCount} file(s).` });
  }
}

["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
  window.addEventListener(name, (e) => { if (hasFilePayload(e)) e.preventDefault(); });
});

window.addEventListener("dragenter", handleDragEnter);
window.addEventListener("dragover", handleDragOver);
window.addEventListener("dragleave", handleDragLeave);
window.addEventListener("drop", handleDrop);
