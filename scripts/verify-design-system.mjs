#!/usr/bin/env node
/**
 * verify-design-system.mjs — UCA-106 (Phase 4a)
 *
 * Asserts the expanded design system lands cleanly:
 *   - 5 accent families (amber default + indigo/teal/rose/slate)
 *     driven by html[data-accent]
 *   - 3 density levels via html[data-density] writing --pad / --row-h
 *   - Status triples (bg/border/text) for 5 states, in both light
 *     and dark override blocks
 *   - JetBrains Mono leads the --font-mono cascade
 *   - .zh bilingual label + .pill (7 variants) + .tag components
 *     present in shared.css
 *   - console.html and overlay.html declare default accent=amber
 *     and density=roomy on <html>
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const tokens = read("src/desktop/renderer/tokens.css");
const shared = read("src/desktop/renderer/shared.css");
const consoleHtml = read("src/desktop/renderer/console.html");
const overlayHtml = read("src/desktop/renderer/overlay.html");

// ── accent families ───────────────────────────────────────────────────
for (const name of ["amber", "indigo", "teal", "rose", "slate"]) {
  const re = new RegExp(`html\\[data-accent="${name}"\\](?:\\s*,\\s*:root)?\\s*\\{[^}]*--accent:\\s*[^;]+;[^}]*--accent-strong:[^}]*--accent-soft:[^}]*--accent-ink:`, "s");
  assert.ok(re.test(tokens), `tokens.css missing [data-accent="${name}"] family`);
}
// amber shares the :root default
assert.ok(
  /html\[data-accent="amber"\]\s*,\s*:root\s*\{/.test(tokens),
  "amber must be the :root default"
);

// ── density levels ────────────────────────────────────────────────────
for (const level of ["compact", "balanced", "roomy"]) {
  const re = new RegExp(`html\\[data-density="${level}"\\]\\s*\\{[^}]*--pad:\\s*\\d+px[^}]*--row-h:\\s*\\d+px`, "s");
  assert.ok(re.test(tokens), `tokens.css missing [data-density="${level}"]`);
}
// Default density tokens exist.
assert.ok(/--pad:\s*18px/.test(tokens), "default --pad must be 18px (roomy)");
assert.ok(/--row-h:\s*48px/.test(tokens), "default --row-h must be 48px (roomy)");

// ── status triples (5 states × 3 roles, both light and dark) ──────────
for (const state of ["success", "running", "queued", "error", "info"]) {
  for (const role of ["bg", "border", "text"]) {
    assert.ok(
      tokens.includes(`--status-${state}-${role}:`),
      `tokens.css missing --status-${state}-${role}`
    );
  }
}
// Dark override re-defines at least success + running + error.
for (const state of ["success", "running", "error"]) {
  const darkBlockRe = new RegExp(`data-theme="dark"[\\s\\S]*?--status-${state}-bg`, "s");
  assert.ok(darkBlockRe.test(tokens), `dark theme must re-tune --status-${state}-bg`);
}

// ── font cascade ──────────────────────────────────────────────────────
assert.ok(
  /--font-mono:\s*"JetBrains Mono"/.test(tokens),
  "--font-mono must lead with JetBrains Mono"
);

// ── bilingual + pill + tag in shared.css ──────────────────────────────
assert.ok(/\.zh\s*\{[^}]*font-size:\s*var\(--fs-sm\)/.test(shared), ".zh utility missing");
for (const variant of ["pill-success", "pill-running", "pill-queued", "pill-error", "pill-info", "pill-neutral", "pill-warning"]) {
  assert.ok(
    new RegExp(`\\.pill\\.${variant}\\s*\\{`).test(shared),
    `shared.css missing .pill.${variant}`
  );
}
assert.ok(/\.tag\s*\{[^}]*font-family:\s*var\(--font-mono\)/.test(shared), ".tag utility missing or not mono");

// ── html defaults on both documents ───────────────────────────────────
assert.ok(
  /<html[^>]*data-accent="amber"[^>]*data-density="roomy"/.test(consoleHtml),
  "console.html <html> must declare data-accent=amber + data-density=roomy"
);
assert.ok(
  /<html[^>]*data-accent="amber"[^>]*data-density="roomy"/.test(overlayHtml),
  "overlay.html <html> must declare data-accent=amber + data-density=roomy"
);

// ── canonical accent names still resolve (backwards compat) ───────────
assert.ok(/--accent:\s*#d97706/.test(tokens), "amber's --accent should be #d97706 in :root");
assert.ok(/--accent-ink:\s*#ffffff/.test(tokens), "accent family must write --accent-ink");

// ── legacy --accent (black) retired, --teal-soft kept for compat ──────
assert.ok(/--teal-soft:/.test(tokens), "--teal-soft retained for legacy consumers");

console.log("ok verify-design-system");
