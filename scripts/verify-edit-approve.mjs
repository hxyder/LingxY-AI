#!/usr/bin/env node
/**
 * verify-edit-approve.mjs — UCA-103 (Phase 3c)
 *
 * Functional check on the helper that decides which approval fields are
 * editable + safety check on the Save & Approve wire-up in console.js.
 * Parses only the pure-data helpers (no DOM) so we don't need jsdom.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const consoleJs = read("src/desktop/renderer/console.js");

// ── renderApprovalItem + helper both exist ───────────────────────────────
assert.ok(/function renderApprovalItem\s*\(/.test(consoleJs), "renderApprovalItem missing");
assert.ok(
  /function deriveEditableApprovalFields\s*\(/.test(consoleJs),
  "deriveEditableApprovalFields missing"
);

// ── Save & Approve button wires overrides into the approve POST ─────────
assert.ok(
  /data-save-approve-id=/.test(consoleJs),
  "approval row must render a Save & Approve button with data-save-approve-id"
);
assert.ok(
  /overrides\[key\]\s*=\s*value/.test(consoleJs)
    || /overrides: JSON|overrides\s*=/.test(consoleJs),
  "Save & Approve click handler must build overrides from input fields"
);
assert.ok(
  /"\/approvals\/"\s*\+|approvals\/\$\{encodeURIComponent\(id\)\}\/approve/.test(consoleJs)
    || /approvals\/\$\{encodeURIComponent\(.+\)\}\/approve/.test(consoleJs),
  "Save & Approve click handler must POST to /approvals/:id/approve"
);
assert.ok(
  /body: JSON\.stringify\(\{\s*actor:\s*"desktop_console",\s*overrides\s*\}\)/.test(consoleJs),
  "approve POST body must include actor + overrides"
);

// ── field derivation helper: run it on a fake approval and inspect ──────
// Dynamically import console.js is brittle because it has DOM imports,
// so we load the helper by regex-extracting it and eval'ing in a sandbox
// -- done via a lightweight Function constructor on the source slice.
const helperMatch = consoleJs.match(
  /function deriveEditableApprovalFields\([^)]*\)\s*\{[\s\S]*?\n\}/
);
assert.ok(helperMatch, "could not locate deriveEditableApprovalFields source");
// eslint-disable-next-line no-new-func
const helper = new Function(`${helperMatch[0]}; return deriveEditableApprovalFields;`)();

// Email-style approval.
const emailFields = helper({
  status: "pending",
  proposed_params: {
    to: ["alice@example.com", "bob@example.com"],
    subject: "Hello",
    body: "A test"
  }
});
const emailKeys = emailFields.map((f) => f.key);
assert.deepEqual(emailKeys, ["to", "subject", "body"], `email keys: ${emailKeys.join(",")}`);
assert.equal(emailFields.find((f) => f.key === "to").value, "alice@example.com, bob@example.com");
assert.equal(emailFields.find((f) => f.key === "body").kind, "textarea");

// Connector workflow wraps its payload under .input.
const workflowFields = helper({
  status: "pending",
  proposed_params: {
    input: { to: ["c@x"], subject: "S", body: "B" },
    workflowId: "google.gmail.send"
  }
});
assert.equal(workflowFields.length, 3, "workflow.input keys should surface");

// Calendar-style.
const calendarFields = helper({
  status: "pending",
  proposed_params: {
    title: "Mtg",
    startTime: "2026-04-21T13:00:00Z",
    endTime: "2026-04-21T13:30:00Z"
  }
});
assert.deepEqual(
  calendarFields.map((f) => f.key),
  ["title", "startTime", "endTime"]
);

// Non-pending approvals yield no editable fields.
const decided = helper({ status: "approved", proposed_params: { subject: "X" } });
assert.equal(decided.length, 0, "decided approvals must not be editable");

// Unknown payload shape: no fields surface, no crash.
const unknown = helper({ status: "pending", proposed_params: { random: "value" } });
assert.equal(unknown.length, 0);

console.log("ok verify-edit-approve");
