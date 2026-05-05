import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  applyVoiceRecordingView,
  formatNoteElapsed,
  resetVoiceTranscriptView,
  setVoiceCardMode
} from "../../src/desktop/renderer/overlay-audio-view.mjs";

function fixture() {
  const { document } = parseHTML(`
    <body>
      <button id="voiceToggleBtn"></button>
      <section id="voiceCard" class="voice-card idle error"></section>
      <button id="tabVoiceBtn" class="active"></button>
      <button id="tabNoteBtn"></button>
      <div id="voiceStatus"></div>
      <div id="voiceTranscript">old text</div>
      <button id="voiceStartBtn">开始</button>
      <button id="voiceStopBtn"></button>
    </body>
  `);
  return {
    voiceCard: document.querySelector("#voiceCard"),
    tabVoiceBtn: document.querySelector("#tabVoiceBtn"),
    tabNoteBtn: document.querySelector("#tabNoteBtn"),
    voiceStatus: document.querySelector("#voiceStatus"),
    voiceTranscript: document.querySelector("#voiceTranscript"),
    voiceToggleBtn: document.querySelector("#voiceToggleBtn"),
    voiceStartBtn: document.querySelector("#voiceStartBtn"),
    voiceStopBtn: document.querySelector("#voiceStopBtn")
  };
}

test("formatNoteElapsed clamps invalid and negative values", () => {
  assert.equal(formatNoteElapsed(-10), "00:00");
  assert.equal(formatNoteElapsed(Number.NaN), "00:00");
  assert.equal(formatNoteElapsed(65_432), "01:05");
});

test("setVoiceCardMode keeps tab state and card data-mode in sync", () => {
  const els = fixture();
  setVoiceCardMode(els, "note");

  assert.equal(els.voiceCard.getAttribute("data-mode"), "note");
  assert.equal(els.tabVoiceBtn.classList.contains("active"), false);
  assert.equal(els.tabNoteBtn.classList.contains("active"), true);

  setVoiceCardMode(els, "voice");
  assert.equal(els.voiceCard.getAttribute("data-mode"), "voice");
  assert.equal(els.tabVoiceBtn.classList.contains("active"), true);
  assert.equal(els.tabNoteBtn.classList.contains("active"), false);
});

test("resetVoiceTranscriptView restores placeholder text and scroll", () => {
  const els = fixture();
  els.voiceTranscript.scrollTop = 25;

  resetVoiceTranscriptView(els.voiceTranscript);

  assert.equal(els.voiceTranscript.classList.contains("placeholder"), true);
  assert.equal(els.voiceTranscript.textContent, "实时识别的文字会显示在这里…");
  assert.equal(els.voiceTranscript.scrollTop, 0);
});

test("applyVoiceRecordingView toggles listening affordances", () => {
  const els = fixture();

  applyVoiceRecordingView(els, true);
  assert.equal(els.voiceCard.classList.contains("idle"), false);
  assert.equal(els.voiceCard.classList.contains("error"), false);
  assert.equal(els.voiceToggleBtn.classList.contains("recording"), true);
  assert.equal(els.voiceStatus.textContent, "🎙 正在聆听...");
  assert.equal(els.voiceStartBtn.textContent, "重启");

  applyVoiceRecordingView(els, false);
  assert.equal(els.voiceCard.classList.contains("idle"), true);
  assert.equal(els.voiceToggleBtn.classList.contains("recording"), false);
  assert.equal(els.voiceStartBtn.textContent, "开始");
});

