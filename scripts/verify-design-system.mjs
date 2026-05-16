#!/usr/bin/env node
/**
 * verify-design-system.mjs — UCA-106 (Phase 4a)
 *
 * Asserts the expanded design system lands cleanly:
 *   - system-blue default accent, with legacy html[data-accent] aliases
 *     still resolving for older documents
 *   - 3 density levels via html[data-density] writing --pad / --row-h
 *   - Status triples (bg/border/text) for 5 states, in both light
 *     and dark override blocks
 *   - JetBrains Mono leads the --font-mono cascade
 *   - .zh bilingual label + .pill (7 variants) + .tag components
 *     present in shared.css
 *   - console.html can rely on the root default accent while both shell
 *     documents declare a recognized density
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const tokens = read("src/desktop/renderer/tokens.css");
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");
const consoleHtml = read("src/desktop/renderer/console.html");
const overlayHtml = read("src/desktop/renderer/overlay.html");

// ── accent families (system default + legacy aliases) ─────────────────
// PMAT-013: light mode no longer defaults to a warm accent. :root and the
// legacy terra/amber aliases all resolve to Apple system blue.
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
// terra and amber share the :root default values by declaration.
assert.ok(
  /html\[data-accent="terra"\]\s*\{/.test(tokens),
  "terra must be declared as an explicit accent"
);
assert.ok(
  /html\[data-accent="terra"\]\s*\{[^}]*--accent:\s*#007aff;[^}]*--accent-strong:\s*#005ecb;[^}]*--accent-soft:\s*#e8f2ff;[^}]*--accent-ink:\s*#ffffff;/s.test(tokens),
  "terra must resolve to the system-blue default"
);
assert.ok(
  /html\[data-accent="amber"\]\s*\{[^}]*--accent:\s*#007aff;[^}]*--accent-strong:\s*#005ecb;[^}]*--accent-soft:\s*#e8f2ff;[^}]*--accent-ink:\s*#ffffff;/s.test(tokens),
  "legacy amber must resolve to the system-blue default"
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
// PMAT-013: Console relies on :root's system-blue default and must not set
// amber. Overlay may still declare a legacy/default accent explicitly.
const acceptAccent = /data-accent="(?:terra|amber)"/;
const acceptDensity = /data-density="(?:regular|roomy|balanced)"/;
assert.ok(
  !/data-accent="amber"/.test(consoleHtml) && acceptDensity.test(consoleHtml),
  "console.html <html> must avoid amber and declare a recognized data-density"
);
assert.ok(
  acceptAccent.test(overlayHtml) && acceptDensity.test(overlayHtml),
  "overlay.html <html> must declare a recognized data-accent + data-density"
);

// ── canonical accent names still resolve ──────────────────────────────
assert.ok(/--accent:\s*#007aff/.test(tokens), "default --accent should be Apple system blue (#007aff)");
assert.ok(/--accent-ink:\s*#ffffff/.test(tokens), "accent family must write --accent-ink");

// ── legacy --teal-soft kept for compat ────────────────────────────────
assert.ok(/--teal-soft:/.test(tokens), "--teal-soft retained for legacy consumers");

// ── UCA-120 / UCA-180: neutral white/black palette in tokens.css ──────
assert.ok(/--bg:\s*#ffffff/.test(tokens), "light --bg must be #ffffff (pure white)");
assert.ok(/--ink:\s*#1d1d1f/.test(tokens), "light --ink must be #1d1d1f (Apple label)");
const darkBlock = (tokens.match(/:is\(html, body\)\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/) ?? [""])[0];
assert.ok(/--bg:\s*#000000/.test(darkBlock), "dark --bg must be #000000");
assert.ok(/--ink:\s*#f5f5f7/.test(darkBlock), "dark --ink must be #f5f5f7");

// ── UCA-120: .btn canonical spec ──────────────────────────────────────
// .btn base: height 32, .btn-sm: 26, .btn-lg: 38.
// UCA-124: .btn spec split from bare `button` — the bare button
// selector no longer forces height/white-space to avoid squashing
// multi-line button components like .task-item.
assert.ok(
  /\.btn\s*\{[\s\S]*?height:\s*32px/.test(shared),
  ".btn base must declare height: 32px"
);
assert.ok(
  /\.btn-sm\s*\{[\s\S]*?height:\s*26px/.test(shared),
  ".btn-sm must declare height: 26px"
);
assert.ok(
  /\.btn-lg\s*\{[\s\S]*?height:\s*38px/.test(shared),
  ".btn-lg must declare height: 38px (new in UCA-120)"
);
assert.ok(
  /\.btn-group\s*\{[\s\S]*?gap:\s*6px/.test(shared),
  ".btn-group utility must declare a 6px gap"
);

console.log("ok verify-design-system");
