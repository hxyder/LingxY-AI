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

// ── accent families (v3 names + legacy aliases) ───────────────────────
// v3 renamed the accent families: terra / ink / olive / ocean / plum.
// Legacy names (amber/indigo/teal/rose/slate) are kept as aliases so any
// existing html[data-accent="amber"] still resolves to a palette.
for (const name of ["terra", "ink", "olive", "ocean", "plum"]) {
  const re = new RegExp(`html\\[data-accent="${name}"\\]\\s*\\{[^}]*--accent:\\s*[^;]+;[^}]*--accent-strong:[^}]*--accent-soft:[^}]*--accent-ink:`, "s");
  assert.ok(re.test(tokens), `tokens.css missing [data-accent="${name}"] family`);
}
for (const legacy of ["amber", "indigo", "teal", "rose", "slate"]) {
  assert.ok(
    new RegExp(`html\\[data-accent="${legacy}"\\]\\s*\\{[^}]*--accent:`).test(tokens),
    `tokens.css missing legacy alias [data-accent="${legacy}"]`
  );
}
// terra shares the :root default.
assert.ok(
  /html\[data-accent="terra"\]\s*\{/.test(tokens),
  "terra must be declared as an explicit accent"
);
assert.ok(
  /:root,\s*\n?\s*html\[data-accent="terra"\]|html\[data-accent="terra"\]\s*,\s*:root/.test(tokens),
  "terra must share the :root default"
);

// ── density levels (v3 names + legacy aliases) ────────────────────────
for (const level of ["compact", "regular", "roomy"]) {
  const re = new RegExp(`html\\[data-density="${level}"\\]\\s*\\{[^}]*--pad:\\s*\\d+px[^}]*--row-h:\\s*\\d+px`, "s");
  assert.ok(re.test(tokens), `tokens.css missing [data-density="${level}"]`);
}
// legacy "balanced" kept as alias
assert.ok(
  /html\[data-density="balanced"\]\s*\{/.test(tokens),
  "tokens.css missing legacy density alias [data-density=\"balanced\"]"
);
// Default density tokens exist (v3 defaults to "regular": 14 / 36).
assert.ok(/--pad:\s*14px/.test(tokens), "default --pad must be 14px (regular)");
assert.ok(/--row-h:\s*36px/.test(tokens), "default --row-h must be 36px (regular)");

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
  /--font-mono:\s*['"]JetBrains Mono['"]/.test(tokens),
  "--font-mono must lead with JetBrains Mono"
);

// ── bilingual + pill + tag in shared.css ──────────────────────────────
assert.ok(/\.zh\s*\{[^}]*font-size:\s*var\(--fs-sm\)/.test(shared), ".zh utility missing");
// Pill variants can use compound (.pill.pill-success) OR stand-alone
// (.pill-success) selectors. Accept either.
for (const variant of ["pill-success", "pill-running", "pill-queued", "pill-error", "pill-info", "pill-neutral", "pill-warning"]) {
  const compound = new RegExp(`\\.pill\\.${variant}\\s*[,{]`);
  const standalone = new RegExp(`\\.${variant}(?:,|\\s*[,{])`);
  assert.ok(
    compound.test(shared) || standalone.test(shared),
    `shared.css missing .${variant} (compound or stand-alone)`
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

// ── canonical accent names still resolve ──────────────────────────────
assert.ok(/--accent:\s*#b85c2a/.test(tokens), "terra's --accent should be #b85c2a in :root");
assert.ok(/--accent-ink:\s*#ffffff/.test(tokens), "accent family must write --accent-ink");

// ── legacy --teal-soft kept for compat ────────────────────────────────
assert.ok(/--teal-soft:/.test(tokens), "--teal-soft retained for legacy consumers");

console.log("ok verify-design-system");
