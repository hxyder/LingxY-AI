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
import {
  filterDeletedRecords,
  isDeletedRecord,
  markRecordDeleted,
  restoreDeletedRecord
} from "../core/deletion-lifecycle.mjs";

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
  const normalized = {
    id: typeof note.id === "string" && note.id ? note.id : makeId(),
    title: typeof note.title === "string" ? note.title : "",
    body_html: typeof note.body_html === "string" ? note.body_html : "",
    group: typeof note.group === "string" ? note.group : "",
    created_at: typeof note.created_at === "string" ? note.created_at : ts,
    updated_at: typeof note.updated_at === "string" ? note.updated_at : ts,
    history: Array.isArray(note.history) ? note.history.slice(-50) : []
  };
  for (const field of ["deleted_at", "deleted_by", "restore_until", "deletion_reason", "restored_at", "restored_by"]) {
    if (typeof note[field] === "string" && note[field]) {
      normalized[field] = note[field];
    }
  }
  return normalized;
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
    listNotes(options = {}) {
      return filterDeletedRecords(readFile().notes, options);
    },
    saveNotes(incoming) {
      const existing = readFile().notes;
      const incomingNotes = (Array.isArray(incoming) ? incoming : [])
        .map(normalizeNote)
        .filter(Boolean);
      const incomingIds = new Set(incomingNotes.map((note) => note.id));
      const preservedDeleted = existing.filter((note) =>
        isDeletedRecord(note) && !incomingIds.has(note.id)
      );
      const notes = [...incomingNotes, ...preservedDeleted];
      const state = { schema_version: SCHEMA_VERSION, notes };
      writeFile(state);
      return filterDeletedRecords(notes);
    },
    upsertNote(note) {
      const state = readFile();
      const normalized = normalizeNote(note);
      if (!normalized) return null;
      const idx = state.notes.findIndex((n) => n.id === normalized.id);
      if (idx >= 0) {
        const existing = state.notes[idx];
        if (isDeletedRecord(existing) && !isDeletedRecord(normalized) && !normalized.restored_at) {
          return existing;
        }
        state.notes[idx] = normalized;
      } else {
        state.notes.unshift(normalized);
      }
      writeFile(state);
      return normalized;
    },
    deleteNote(id, options = {}) {
      const state = readFile();
      const idx = state.notes.findIndex((n) => n.id === id);
      if (idx < 0) return null;
      if (options.hard === true) {
        const [removed] = state.notes.splice(idx, 1);
        writeFile(state);
        return removed;
      }
      const deleted = markRecordDeleted(state.notes[idx], options);
      state.notes[idx] = deleted;
      writeFile(state);
      return deleted;
    },
    restoreNote(id, options = {}) {
      const state = readFile();
      const idx = state.notes.findIndex((n) => n.id === id);
      if (idx < 0) return null;
      const restored = restoreDeletedRecord(state.notes[idx], options);
      state.notes.splice(idx, 1);
      state.notes.unshift(restored);
      writeFile(state);
      return restored;
    },
    // Append a "chat chip" block to a note's body. If `noteId === "__new__"`
    // (or no matching note exists), create a fresh note with the chip.
    // `title` is honoured only on creation — appending to an existing
    // note never overwrites its title.
    // Returns `{ note, created }` so the caller can surface "added to
    // <title>" feedback.
    appendChip({ noteId, text, sourceLabel = null, title = null }) {
      const state = readFile();
      const trimmed = String(text || "").trim();
      if (!trimmed) return { note: null, created: false };
      // Preserve paragraph + line breaks: blank line → <p>…</p> boundary;
      // single newline inside a paragraph → <br>. Without this the chip
      // collapsed multi-line replies into one wall of text. Each piece
      // is escaped first so model-emitted < / > / & stay literal.
      const paragraphs = trimmed.split(/\n{2,}/);
      const bodyHtml = paragraphs
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
        .join("");
      const labelHtml = sourceLabel
        ? `<div class="note-stamp" contenteditable="false">${escapeHtml(sourceLabel)} · ${escapeHtml(nowIso().slice(0, 16).replace("T", " "))}</div>`
        : "";
      const chipHtml = `${labelHtml}<div class="note-chat-chip">${bodyHtml}</div><p><br></p>`;
      let target = state.notes.find((n) => n.id === noteId && !isDeletedRecord(n));
      let created = false;
      if (!target || noteId === "__new__") {
        const trimmedTitle = String(title ?? "").trim();
        target = normalizeNote({
          id: makeId(),
          title: trimmedTitle || sourceLabel || "Untitled note"
        });
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
