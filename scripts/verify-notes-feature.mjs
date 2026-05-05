#!/usr/bin/env node
/**
 * verify-notes-feature.mjs — UCA-178
 *
 * Locks in the Quick Notes feature added to the console:
 *   - New rail item data-tab="notes", inserted under the Context group.
 *   - Dedicated #panel-notes with list column + editor column.
 *   - Editor carries a title input, created/last-edited timestamps,
 *     a compact format toolbar (bold / italic / H / quote / lists /
 *     link / image / table / hr / inline stamp), font family + size
 *     selectors, and a voice note button that opens the shared overlay
 *     note recorder.
 *   - A local in-note chat strip that lets the user ask questions
 *     and explicitly adopt the reply into the note ("用户同意").
 *   - A Share dialog that exports as text / Markdown / HTML with
 *     an option to include or drop timestamps.
 *   - console.js exposes initNotesIfNeeded() + initQuickNotes() and
 *     routes the "notes" tab to boot the module lazily.
 *   - shared.css covers .notes-layout, .note-item, .notes-editor-body,
 *     .notes-toolbar, .note-stamp, and the share dialog.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const html = read("src/desktop/renderer/console.html");
const js = read("src/desktop/renderer/console.js");
const css = readCssWithImports(root, "src/desktop/renderer/shared.css");

// ── HTML ────────────────────────────────────────────────────────────────
assert.match(html, /<button class="rail-item" data-tab="notes"/,
  "console.html missing rail item for Notes");
assert.match(html, /<section id="panel-notes" class="tab-panel">/,
  "console.html missing #panel-notes section");
assert.match(html, /id="notesNewBtn"/, "missing #notesNewBtn");
assert.match(html, /id="notesList"/, "missing #notesList");
assert.match(html, /id="notesSearchInput"/, "missing #notesSearchInput");
assert.match(html, /id="noteTitleInput"/, "missing #noteTitleInput");
assert.match(html, /id="noteBody".*contenteditable="true"/,
  "#noteBody must be contenteditable");
assert.match(html, /id="noteCreatedTs"/, "missing #noteCreatedTs");
assert.match(html, /id="noteUpdatedTs"/, "missing #noteUpdatedTs");
assert.match(html, /id="noteFontSize"/, "missing #noteFontSize selector");
assert.match(html, /id="noteFontFamily"/, "missing #noteFontFamily selector");
assert.match(html, /id="noteShareBtn"/, "missing #noteShareBtn");
assert.match(html, /id="noteDeleteBtn"/, "missing #noteDeleteBtn");
assert.match(html, /id="noteAdoptFromChatBtn"/, "missing #noteAdoptFromChatBtn");
assert.match(html, /id="noteVoiceBtn"/, "missing #noteVoiceBtn");
assert.match(html, /id="noteChatInput"/, "missing #noteChatInput");
assert.match(html, /id="noteChatLog"/, "missing #noteChatLog");
for (const cmd of ["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList",
  "link", "image", "table", "insertHorizontalRule", "stamp"]) {
  assert.ok(
    new RegExp(`data-cmd="${cmd.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"`).test(html),
    `toolbar missing data-cmd="${cmd}"`
  );
}

// ── CSS ─────────────────────────────────────────────────────────────────
assert.match(css, /\.notes-layout\s*\{/, "shared.css missing .notes-layout");
assert.match(css, /\.notes-list-col/, "missing .notes-list-col");
assert.match(css, /\.notes-editor-col/, "missing .notes-editor-col");
assert.match(css, /\.notes-editor-body/, "missing .notes-editor-body");
assert.match(css, /\.notes-toolbar/, "missing .notes-toolbar");
assert.match(css, /\.note-item/, "missing .note-item");
assert.match(css, /\.note-item\.is-active/, "missing .note-item.is-active state");
assert.match(css, /\.note-stamp/, "missing .note-stamp inline chip");
assert.match(css, /\.notes-ts/, "missing .notes-ts (light-gray timestamp)");
assert.match(css, /\.notes-share-backdrop/, "missing .notes-share-backdrop");
assert.match(css, /\.notes-share-dialog/, "missing .notes-share-dialog");
// Light-gray timestamps must use --muted-2 per the design spec.
assert.match(css, /\.notes-ts\s*\{\s*color:\s*var\(--muted-2\)/,
  ".notes-ts must be colored via --muted-2 (light gray)");

// ── JS module boundary ──────────────────────────────────────────────────
assert.match(js, /function initNotesIfNeeded\(\)/,
  "console.js missing initNotesIfNeeded()");
assert.match(js, /function initQuickNotes\(\)/,
  "console.js missing initQuickNotes()");
assert.match(js, /const\s+LS_KEY\s*=\s*"lingxy\.notes\.v1"/,
  "notes must persist under lingxy.notes.v1 key");
assert.match(js, /switchTab.*notes.*initNotesIfNeeded|if\s*\(tabId\s*===\s*"notes"\)/s,
  "switchTab must boot Notes when the tab becomes active");

// Share/export must offer a timestamp toggle.
assert.match(js, /shareWithTs/, "share dialog must offer a timestamp toggle");
assert.match(js, /exportAsMarkdown/, "missing exportAsMarkdown");
assert.match(js, /exportAsText/, "missing exportAsText");
assert.match(js, /exportAsHtml/, "missing exportAsHtml");

// Chat-to-note adoption flow.
assert.match(js, /adoptLastChatReply|adoptFromChatBtn/,
  "missing adopt-from-chat wiring");
assert.match(js, /appendAdoptedChip/,
  "missing appendAdoptedChip (inserts chat excerpts with a 'From chat' chip)");

// Voice note capture must reuse the shared overlay recorder instead of
// maintaining a second Console-local SpeechRecognition state machine.
assert.match(js, /function openOverlayForNoteVoice\(\)/,
  "missing note voice bridge helper");
assert.match(js, /window\.ucaShell\.openOverlayVoice\(\{\s*mode:\s*"note",\s*autoStart:\s*true\s*\}\)/,
  "note voice button must open overlay note recorder through shell bridge");
assert.equal(/const\s+SR\s*=\s*window\.SpeechRecognition/.test(js), false,
  "notes must not own a Console-local SpeechRecognition recorder");
assert.equal(/new\s+SR\(\)/.test(js), false,
  "notes must not instantiate a Console-local SpeechRecognition recorder");

console.log("ok verify-notes-feature");
