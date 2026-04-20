#!/usr/bin/env node
/**
 * verify-ui-tokens.mjs — UCA-099 (Phase 1: tokens foundation)
 *
 * Asserts the design-token file is the single source of truth:
 *   - tokens.css exists, defines every token renderers actually use
 *   - shared.css delegates to tokens.css (no duplicate :root block)
 *   - overlay.html / console.html no longer carry the retired white /
 *     warm theme blocks
 *   - the overlay container width is parameterised (no 520px literals)
 *   - new scale tokens (font / spacing / duration / z-index /
 *     overlay-width) are declared
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const r = (p) => path.join(root, p);
const read = (p) => readFileSync(r(p), "utf8");

// ── tokens.css exists and declares the expected surface ─────────────────
assert.ok(existsSync(r("src/desktop/renderer/tokens.css")), "tokens.css missing");
const tokens = read("src/desktop/renderer/tokens.css");

// existing legacy tokens (callers depend on these names)
const LEGACY_TOKENS = [
  "--bg-0", "--bg-1", "--bg-2",
  "--surface", "--surface-strong", "--surface-soft", "--surface-dark",
  "--glass", "--glass-border",
  "--ink", "--ink-soft", "--muted",
  "--line", "--line-strong",
  "--accent", "--accent-strong", "--accent-soft",
  "--success", "--warning", "--danger",
  "--shadow-xl", "--shadow-lg", "--shadow-md", "--shadow-sm",
  "--radius-xl", "--radius-lg", "--radius-md", "--radius-sm", "--radius-pill",
  "--font-display", "--font-text", "--font-mono"
];
for (const name of LEGACY_TOKENS) {
  assert.ok(tokens.includes(name + ":"), `tokens.css missing legacy token ${name}`);
}

// new scale tokens introduced by Phase 1
const NEW_TOKENS = [
  "--fs-xs", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg", "--fs-xl", "--fs-2xl",
  "--fw-regular", "--fw-medium", "--fw-semibold",
  "--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8",
  "--duration-fast", "--duration-base", "--duration-slow", "--ease-standard",
  "--z-base", "--z-dropdown", "--z-overlay", "--z-modal", "--z-toast",
  "--overlay-width",
  "--info"
];
for (const name of NEW_TOKENS) {
  assert.ok(tokens.includes(name + ":"), `tokens.css missing new token ${name}`);
}

// must declare both light (:root) and a dark override
assert.ok(/:root\s*\{/.test(tokens), "tokens.css must define :root block");
assert.ok(
  /\[data-theme="dark"\]/.test(tokens),
  "tokens.css must define dark theme override"
);

// ── shared.css delegates to tokens.css ──────────────────────────────────
const shared = read("src/desktop/renderer/shared.css");
assert.ok(
  /@import\s+url\(["']\.\/tokens\.css["']\)/.test(shared),
  "shared.css must @import tokens.css"
);
// The old :root block had color-scheme + --bg-0 + font-family all in one;
// the presence of any of those inside shared.css suggests a stale copy.
assert.ok(
  !/:root\s*\{[^}]*--bg-0/.test(shared),
  "shared.css still has a :root block defining --bg-0 — tokens.css owns that now"
);

// ── retired themes are gone from overlay.html + console.html ────────────
for (const file of [
  "src/desktop/renderer/overlay.html",
  "src/desktop/renderer/console.html"
]) {
  const text = read(file);
  assert.ok(
    !/data-theme="white"/.test(text),
    `${file} still contains data-theme="white" — should be retired`
  );
  assert.ok(
    !/data-theme="warm"/.test(text),
    `${file} still contains data-theme="warm" — should be retired`
  );
}

// ── overlay container width parameterised ───────────────────────────────
const overlay = read("src/desktop/renderer/overlay.html");
const literal520 = overlay.match(/width:\s*520px/g) ?? [];
assert.equal(
  literal520.length,
  0,
  `overlay.html still has ${literal520.length} literal 520px widths — should use var(--overlay-width)`
);
assert.ok(
  overlay.includes("var(--overlay-width)"),
  "overlay.html must reference var(--overlay-width) for container sizing"
);

// ── console theme picker reduced to 2 ───────────────────────────────────
const consoleHtml = read("src/desktop/renderer/console.html");
const swatchCount = (consoleHtml.match(/class="theme-swatch[^"]*"\s+data-theme-value/g) ?? []).length;
assert.equal(
  swatchCount,
  2,
  `expected 2 theme swatches (light + dark), found ${swatchCount}`
);

console.log("ok verify-ui-tokens");
