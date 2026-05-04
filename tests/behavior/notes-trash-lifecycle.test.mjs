import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleNoteProjectConversationRoute } from "../../src/service/core/http-routes/note-project-conversation-routes.mjs";
import { createNotesStore } from "../../src/service/store/notes-store.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

function jsonRequest(body = {}, headers = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
  request.headers = headers;
  return request;
}

function captureResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    }
  };
}

function parsePayload(response) {
  return response.body ? JSON.parse(response.body) : null;
}

async function notesRoute({ method, pathname, body = {}, actor = "desktop_console", notesStore }) {
  const response = captureResponse();
  const handled = await tryHandleNoteProjectConversationRoute({
    request: jsonRequest(body, actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method,
    url: new URL(`http://127.0.0.1${pathname}`),
    runtime: { notesStore },
    saveRuntimeConfig() {
      throw new Error("unexpected config write");
    }
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response)
  };
}

async function withNotesStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-notes-trash-"));
  try {
    return await fn(createNotesStore({ filePath: path.join(dir, "notes.json") }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("notes store soft delete hides notes by default and preserves trash across bulk saves", async () => {
  await withNotesStore((store) => {
    store.upsertNote({
      id: "note_keep",
      title: "Keep",
      body_html: "<p>keep</p>",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    store.upsertNote({
      id: "note_delete",
      title: "Delete",
      body_html: "<p>delete</p>",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });

    const deleted = store.deleteNote("note_delete", {
      actor: "desktop_console",
      now: "2026-01-02T00:00:00.000Z"
    });
    assert.equal(deleted.id, "note_delete");
    assert.equal(deleted.deleted_at, "2026-01-02T00:00:00.000Z");
    assert.deepEqual(store.listNotes().map((note) => note.id), ["note_keep"]);
    assert.deepEqual(store.listNotes({ deleted: "only" }).map((note) => note.id), ["note_delete"]);

    store.saveNotes([{
      id: "note_keep",
      title: "Keep edited",
      body_html: "<p>keep edited</p>",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z"
    }]);
    assert.deepEqual(store.listNotes({ deleted: "only" }).map((note) => note.id), ["note_delete"]);

    const restored = store.restoreNote("note_delete", {
      actor: "desktop_console",
      now: "2026-01-04T00:00:00.000Z"
    });
    assert.equal(restored.id, "note_delete");
    assert.equal(restored.deleted_at, undefined);
    assert.deepEqual(store.listNotes().map((note) => note.id), ["note_delete", "note_keep"]);
  });
});

test("notes HTTP routes expose default active list, trash list, and restore", async () => {
  await withNotesStore(async (store) => {
    store.upsertNote({
      id: "note_http",
      title: "HTTP",
      body_html: "<p>body</p>",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });

    const deleted = await notesRoute({
      method: "POST",
      pathname: "/notes/delete",
      body: { id: "note_http" },
      notesStore: store
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.payload.ok, true);
    assert.equal(deleted.payload.note.id, "note_http");
    assert.equal(typeof deleted.payload.note.deleted_at, "string");

    const active = await notesRoute({
      method: "GET",
      pathname: "/notes",
      notesStore: store
    });
    assert.equal(active.payload.notes.length, 0);

    const trash = await notesRoute({
      method: "GET",
      pathname: "/notes?deleted=only",
      notesStore: store
    });
    assert.equal(trash.payload.notes.length, 1);
    assert.equal(trash.payload.notes[0].id, "note_http");

    const restored = await notesRoute({
      method: "POST",
      pathname: "/notes/restore",
      body: { id: "note_http" },
      notesStore: store
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.payload.ok, true);
    assert.equal(restored.payload.note.deleted_at, undefined);
    assert.equal(store.listNotes().length, 1);
  });
});
