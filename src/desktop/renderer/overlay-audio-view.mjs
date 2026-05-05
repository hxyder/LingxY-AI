export function formatNoteElapsed(ms) {
  const numericMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSec = Math.floor(numericMs / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function setVoiceCardMode({
  voiceCard,
  tabVoiceBtn,
  tabNoteBtn
} = {}, mode = "voice") {
  voiceCard?.setAttribute("data-mode", mode);
  tabVoiceBtn?.classList.toggle("active", mode === "voice");
  tabNoteBtn?.classList.toggle("active", mode === "note");
}

export function resetVoiceTranscriptView(voiceTranscript, {
  placeholder = "实时识别的文字会显示在这里…"
} = {}) {
  if (!voiceTranscript) return;
  voiceTranscript.textContent = placeholder;
  voiceTranscript.classList.add("placeholder");
  voiceTranscript.scrollTop = 0;
}

export function applyVoiceRecordingView({
  voiceCard,
  voiceStatus,
  voiceToggleBtn,
  voiceStartBtn,
  voiceStopBtn
} = {}, active) {
  if (active) {
    voiceCard?.classList.remove("idle", "error");
    if (voiceStatus) voiceStatus.textContent = "🎙 正在聆听...";
    voiceToggleBtn?.classList.add("recording");
    if (voiceStartBtn) {
      voiceStartBtn.disabled = false;
      voiceStartBtn.textContent = "重启";
    }
    if (voiceStopBtn) voiceStopBtn.disabled = false;
    return;
  }

  voiceCard?.classList.add("idle");
  voiceToggleBtn?.classList.remove("recording");
  if (voiceStartBtn) {
    voiceStartBtn.disabled = false;
    voiceStartBtn.textContent = "开始";
  }
  if (voiceStopBtn) voiceStopBtn.disabled = false;
}

