// Disk-backed notes store — single source of truth shared between the
// console window and the overlay window. Both windows previously kept
// their own localStorage copy and could not see each other's edits;
// this store moves notes to a JSON file alongside the other runtime
// data and exposes load / save / append-chip operations.
//
// Schema is intentionally identical to what the console renderer was
// already storing in `lingxy.notes.v1`, so existing browser-cached
// notes can be migrated on first load.
//
// Concurrency model: the store always writes the full array on save.
// Notes are small (~few KB each) so a per-write atomic rewrite is
// fine; if this ever becomes a hotspot we can switch to per-note
// records in SQLite.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function nowIso() { return new Date().toISOString(); }
function makeId() {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeNote(note = {}) {
  if (!note || typeof note !== "object") return null;
  const ts = nowIso();
  return {
    id: typeof note.id === "string" && note.id ? note.id : makeId(),
    title: typeof note.title === "string" ? note.title : "",
    body_html: typeof note.body_html === "string" ? note.body_html : "",
    group: typeof note.group === "string" ? note.group : "",
    created_at: typeof note.created_at === "string" ? note.created_at : ts,
    updated_at: typeof note.updated_at === "string" ? note.updated_at : ts,
    history: Array.isArray(note.history) ? note.history.slice(-50) : []
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));
}

export function createNotesStore({ filePath } = {}) {
  if (!filePath) throw new Error("createNotesStore: filePath required");

  function ensureDir() {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readFile() {
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = safeParse(raw);
      if (!parsed) return { schema_version: SCHEMA_VERSION, notes: [] };
      const notes = Array.isArray(parsed.notes) ? parsed.notes : (Array.isArray(parsed) ? parsed : []);
      return {
        schema_version: SCHEMA_VERSION,
        notes: notes.map(normalizeNote).filter(Boolean)
      };
    } catch {
      return { schema_version: SCHEMA_VERSION, notes: [] };
    }
  }

  function writeFile(state) {
    ensureDir();
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  return {
    listNotes() {
      return readFile().notes;
    },
    saveNotes(incoming) {
      const notes = (Array.isArray(incoming) ? incoming : [])
        .map(normalizeNote)
        .filter(Boolean);
      const state = { schema_version: SCHEMA_VERSION, notes };
      writeFile(state);
      return notes;
    },
    upsertNote(note) {
      const state = readFile();
      const normalized = normalizeNote(note);
      if (!normalized) return null;
      const idx = state.notes.findIndex((n) => n.id === normalized.id);
      if (idx >= 0) state.notes[idx] = normalized;
      else state.notes.unshift(normalized);
      writeFile(state);
      return normalized;
    },
    deleteNote(id) {
      const state = readFile();
      const next = state.notes.filter((n) => n.id !== id);
      const removed = next.length !== state.notes.length;
      if (removed) writeFile({ ...state, notes: next });
      return removed;
    },
    // Append a "chat chip" block to a note's body. If `noteId === "__new__"`
    // (or no matching note exists), create a fresh note with the chip.
    // Returns `{ note, created }` so the caller can surface "added to
    // <title>" feedback.
    appendChip({ noteId, text, sourceLabel = null }) {
      const state = readFile();
      const safe = escapeHtml(String(text || "").trim());
      if (!safe) return { note: null, created: false };
      const labelHtml = sourceLabel
        ? `<div class="note-stamp" contenteditable="false">${escapeHtml(sourceLabel)} · ${escapeHtml(nowIso().slice(0, 16).replace("T", " "))}</div>`
        : "";
      const chipHtml = `${labelHtml}<div class="note-chat-chip">${safe}</div><p><br></p>`;
      let target = state.notes.find((n) => n.id === noteId);
      let created = false;
      if (!target || noteId === "__new__") {
        target = normalizeNote({ id: makeId(), title: sourceLabel || "Untitled note" });
        target.body_html = chipHtml;
        state.notes.unshift(target);
        created = true;
      } else {
        target.body_html = (target.body_html || "") + chipHtml;
        target.updated_at = nowIso();
      }
      writeFile(state);
      return { note: target, created };
    }
  };
}
