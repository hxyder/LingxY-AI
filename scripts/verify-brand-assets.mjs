#!/usr/bin/env node
/**
 * verify-brand-assets.mjs — UCA-099-pre, C18 #B5 round-3
 *
 * Asserts the LingxY brand identity stays consistent across BOTH
 * the SVG/HTML/CSS domain (round-2) AND the native (Electron / OS)
 * icon domain (round-3): BrowserWindow taskbar/title icon, Tray icon,
 * Notification fallback, Windows AUMID grouping.
 *
 * Round-2 only checked SVG-domain consumers (mark.svg, wordmark.svg,
 * icons.mjs LOGO_MARK, console.html .rail-brand-mark). After that
 * landed, R reported the Windows taskbar/title icon and tray icon
 * still showed the legacy Electron / indigo-orb visuals — those live
 * in `src/desktop/tray/electron-main.mjs` and were never wired to
 * the brand mark. Round-3 closes this gap.
 *
 * Invariants enforced here (any one failing trips the gate):
 *
 *  SVG/HTML domain (round-2):
 *   1. lingxy-mark.svg / lingxy-wordmark.svg embed an <image> with a
 *      data:image/png;base64,... href, viewBox 0 0 32 32.
 *   2. Every SVG-domain consumer's embedded base64 decodes to bytes
 *      whose sha256 matches the canonical assets/icons/lingxy-64.png.
 *   3. No legacy vector geometry inside brand SVGs (<path>/<circle>/
 *      <polygon>/<polyline>/<rect>).
 *   4. console.html .rail-brand-mark AND .topbar-logo wrappers must
 *      NOT paint a `linear-gradient(...var(--accent)...)` background.
 *   5. console.html carries the LingxY brand label (no "U", no "UCA
 *      Console").
 *
 *  Native domain (round-3):
 *   6. assets/icons/ contains the canonical PNG size set + .ico.
 *   7. electron-main.mjs calls `app.setAppUserModelId(...)` so the
 *      Windows taskbar groups under the LingxY AUMID instead of the
 *      Electron default (root cause of R's "blue electron orb" report).
 *   8. brand-icons.mjs exists and exports the resolver + helpers.
 *   9. Every `new BrowserWindow(` callsite is brand-aware: either
 *      goes through `createBrandedBrowserWindow` (electron-main, link/
 *      preview windows) or through `newBrandedWindow` (popup-card-
 *      manager wrapping the same helper). Raw `new BrowserWindow(`
 *      with no nearby brand wiring is rejected.
 *  10. Tray icon goes through `brandIcons.composeTrayIcon`, not the
 *      legacy indigo-orb buildTrayIcon (color/gradient signatures).
 *  11. Notification fallback goes through `brandIcons.createBranded
 *      Notification`, not raw `new Notification(`.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function walkJsFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip node_modules / generated / output dirs.
      if (entry === "node_modules" || entry === "dist" || entry === "out") continue;
      walkJsFiles(full, acc);
    } else if (/\.(mjs|cjs|js)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const CANONICAL_PNG_PATH = path.join(root, "assets/icons/lingxy-64.png");
const ICONS_DIR = path.join(root, "assets/icons");
const ICO_PATH = path.join(ICONS_DIR, "lingxy.ico");
const MARK_PATH = path.join(root, "src/desktop/assets/logo/lingxy-mark.svg");
const WORDMARK_PATH = path.join(root, "src/desktop/assets/logo/lingxy-wordmark.svg");
const CONSOLE_PATH = path.join(root, "src/desktop/renderer/console.html");
const ICONS_MJS_PATH = path.join(root, "src/desktop/renderer/icons.mjs");
const ELECTRON_MAIN_PATH = path.join(root, "src/desktop/tray/electron-main.mjs");
const POPUP_CARD_PATH = path.join(root, "src/desktop/tray/popup-card-manager.mjs");
const BRAND_ICONS_PATH = path.join(root, "src/desktop/tray/brand-icons.mjs");

// Sizes we want guaranteed for native domain consumers (16/32 = tray,
// 48/64 = window/notification, 128/256/512 = installer/Start menu).
const REQUIRED_PNG_SIZES = [16, 32, 48, 64, 128, 256, 512];

// ── Canonical hash ───────────────────────────────────────────────────────
assert.ok(
  existsSync(CANONICAL_PNG_PATH),
  `missing canonical brand-source PNG: ${CANONICAL_PNG_PATH} — run scripts/generate-brand-icons.py`
);
const canonicalPngBytes = readFileSync(CANONICAL_PNG_PATH);
const canonicalSha256 = createHash("sha256").update(canonicalPngBytes).digest("hex");

function extractEmbeddedSha256(src, label) {
  const match = src.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(match, `${label} must embed a data:image/png;base64,... URL`);
  const bytes = Buffer.from(match[1], "base64");
  return createHash("sha256").update(bytes).digest("hex");
}

function assertNoVectorGeometry(src, label) {
  const forbidden = ["<path", "<circle", "<polygon", "<polyline", "<rect"];
  for (const tag of forbidden) {
    assert.ok(
      !src.includes(tag),
      `${label} must be image-only — found ${tag} (regression to hand-vector mark)`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SVG/HTML domain (round-2 invariants)
// ─────────────────────────────────────────────────────────────────────────

// lingxy-mark.svg
assert.ok(existsSync(MARK_PATH), `missing brand mark: ${MARK_PATH}`);
const mark = readFileSync(MARK_PATH, "utf8");
assert.ok(/<svg[^>]*viewBox="0 0 32 32"/.test(mark), "mark must use 32x32 viewBox");
assert.ok(/<image\b/.test(mark), "mark must embed canonical PNG via <image>");
assertNoVectorGeometry(mark, "lingxy-mark.svg");
assert.equal(
  extractEmbeddedSha256(mark, "lingxy-mark.svg"),
  canonicalSha256,
  "lingxy-mark.svg embedded PNG sha256 != canonical"
);

// lingxy-wordmark.svg
assert.ok(existsSync(WORDMARK_PATH), `missing wordmark: ${WORDMARK_PATH}`);
const wordmark = readFileSync(WORDMARK_PATH, "utf8");
assert.ok(/<image\b/.test(wordmark), "wordmark must embed canonical PNG via <image>");
assertNoVectorGeometry(wordmark, "lingxy-wordmark.svg");
assert.equal(
  extractEmbeddedSha256(wordmark, "lingxy-wordmark.svg"),
  canonicalSha256,
  "lingxy-wordmark.svg embedded PNG sha256 != canonical"
);
assert.ok(/<text/.test(wordmark) && /LingxY/.test(wordmark), "wordmark must include LingxY text");

// icons.mjs LOGO_MARK
const iconsSrc = readFileSync(ICONS_MJS_PATH, "utf8");
const logoMarkMatch = iconsSrc.match(/export const LOGO_MARK\s*=\s*`([^`]+)`/);
assert.ok(logoMarkMatch, "icons.mjs must export LOGO_MARK as a template literal");
const logoMark = logoMarkMatch[1];
assert.ok(/<image\b/.test(logoMark), "icons.mjs LOGO_MARK must embed canonical PNG via <image>");
assertNoVectorGeometry(logoMark, "icons.mjs LOGO_MARK");
assert.equal(
  extractEmbeddedSha256(logoMark, "icons.mjs LOGO_MARK"),
  canonicalSha256,
  "icons.mjs LOGO_MARK embedded PNG sha256 != canonical"
);

// console.html .rail-brand-mark inline SVG
const consoleHtml = readFileSync(CONSOLE_PATH, "utf8");
const railBrandMatch = consoleHtml.match(
  /<span class="rail-mark rail-brand-mark"[^>]*>([\s\S]*?)<\/span>/
);
assert.ok(railBrandMatch, "console.html must contain a .rail-brand-mark span");
const railBrandInner = railBrandMatch[1];
assert.ok(
  /<svg[^>]*viewBox="0 0 32 32"/.test(railBrandInner),
  "console.html .rail-brand-mark must embed the 32x32 mark SVG"
);
assert.ok(/<image\b/.test(railBrandInner), "console.html .rail-brand-mark must embed canonical PNG");
assertNoVectorGeometry(railBrandInner, "console.html rail-brand-mark inline SVG");
assert.equal(
  extractEmbeddedSha256(railBrandInner, "console.html rail-brand-mark"),
  canonicalSha256,
  "console.html rail-brand-mark embedded PNG sha256 != canonical"
);

// Wrapper-CSS regression guard (round-1 orange-square bug). Round-3
// extends the check to BOTH .rail-brand-mark and .topbar-logo (round-2
// only checked rail-brand-mark; the verifier comment claimed both but
// the implementation lagged — codex round-2 caught this).
for (const wrapper of [".rail-brand-mark", ".topbar-logo"]) {
  // Match the wrapper's first { ... } block. CSS doesn't allow nested
  // braces inside a single rule, so the simple non-greedy match is
  // accurate enough here.
  const re = new RegExp(`\\${wrapper}\\s*\\{[^}]*\\}`);
  const ruleMatch = consoleHtml.match(re);
  if (ruleMatch) {
    assert.ok(
      !/linear-gradient\([^)]*var\(--accent[^)]*\)/.test(ruleMatch[0]),
      `console.html ${wrapper} must not paint an accent gradient — it tints the embedded PNG (round-1 orange-square regression)`
    );
    assert.ok(
      !/background:\s*var\(--ink\)/.test(ruleMatch[0]),
      `console.html ${wrapper} must not paint a solid var(--ink) background — would override embedded PNG silhouette`
    );
  }
}

// Brand label / placeholder regressions
assert.ok(
  !/<div class="topbar-logo">U<\/div>/.test(consoleHtml),
  "console still renders the old 'U' placeholder"
);
assert.ok(
  /(?:topbar-title|rail-brand-label|rail-brand-text[^>]*>[\s\S]*?<strong[^>]*>LingxY)/.test(consoleHtml),
  "console must carry the LingxY brand name"
);
assert.ok(!/UCA Console/.test(consoleHtml), "console must not carry the old 'UCA Console' string");

// ─────────────────────────────────────────────────────────────────────────
// Native domain (round-3 invariants)
// ─────────────────────────────────────────────────────────────────────────

// PNG size set + .ico
for (const size of REQUIRED_PNG_SIZES) {
  const p = path.join(ICONS_DIR, `lingxy-${size}.png`);
  assert.ok(existsSync(p), `missing canonical PNG size: ${p} — run scripts/generate-brand-icons.py`);
}
assert.ok(existsSync(ICO_PATH), `missing canonical Windows .ico: ${ICO_PATH}`);

// brand-icons.mjs exists with the helpers electron-main wires onto
assert.ok(existsSync(BRAND_ICONS_PATH), `missing native icon resolver: ${BRAND_ICONS_PATH}`);
const brandIconsSrc = readFileSync(BRAND_ICONS_PATH, "utf8");
for (const sym of [
  "createBrandIconResolver",
  "BRAND_AUMID",
  "resolveBrandIcon",
  "resolveBrandIcoPath",
  "composeTrayIcon",
  "createBrandedBrowserWindow",
  "createBrandedNotification",
  "showBrandedMessageBox"
]) {
  assert.ok(
    brandIconsSrc.includes(sym),
    `brand-icons.mjs must export/define '${sym}' (round-3+4 contract)`
  );
}

// BRAND_AUMID must equal package.json build.appId. Round-4 codex
// flagged the two values as duplicate sources of truth — the gate
// turns drift into a verifier failure rather than silent
// taskbar/installer mismatch (e.g. installer registers
// `com.uca.desktop` but runtime sends `com.uca.desktop-v2`).
const aumidMatch = brandIconsSrc.match(/export const BRAND_AUMID\s*=\s*"([^"]+)"/);
assert.ok(aumidMatch, "brand-icons.mjs must declare `export const BRAND_AUMID = \"...\"`");
const declaredAumid = aumidMatch[1];
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(
  declaredAumid,
  pkg.build?.appId,
  `BRAND_AUMID (${declaredAumid}) must equal package.json build.appId (${pkg.build?.appId}) — installer/runtime AUMID drift would break Windows taskbar grouping`
);

// electron-main.mjs invariants
const electronMainSrc = readFileSync(ELECTRON_MAIN_PATH, "utf8");

// (a) AUMID call present
assert.ok(
  /app\.setAppUserModelId\s*\(\s*BRAND_AUMID\s*\)/.test(electronMainSrc),
  "electron-main.mjs must call app.setAppUserModelId(BRAND_AUMID) so Windows taskbar groups under LingxY (root cause of round-2's blue electron orb regression)"
);

// (b) brand-icons resolver instantiated
assert.ok(
  /createBrandIconResolver\s*\(\s*\{\s*app,\s*nativeImage\s*\}\s*\)/.test(electronMainSrc),
  "electron-main.mjs must instantiate createBrandIconResolver({ app, nativeImage })"
);

// (c) Every `new BrowserWindow(` site across src/desktop/ is brand-
//     aware. Whitelisted file: brand-icons.mjs (the wrapper helper
//     is the single allowed raw constructor in production code).
//     Allowed callsite forms outside the whitelist:
//       - brandIcons.createBrandedBrowserWindow(BrowserWindow, ...)
//       - newBrandedWindow(...)        (popup-card-manager helper)
//     Round-4 also rejects three known escape patterns codex flagged:
//       - aliasing: `const BW = BrowserWindow; new BW(...)`
//       - reflection: `Reflect.construct(BrowserWindow, ...)`
//       - member dereference at call site: `electron.BrowserWindow(`
function assertBrowserWindowSitesAreBranded(src, label) {
  const lines = src.split("\n");
  const offences = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip line-leading comment so commented-out `new BrowserWindow(`
    // doesn't look like a callsite. (Block-comment handling is a known
    // gap and is fine for our actual sources.)
    const code = line.replace(/^\s*\/\/.*$/, "");
    const isRawConstruct = /\bnew BrowserWindow\s*\(/.test(code);
    const isReflectConstruct = /Reflect\.construct\s*\(\s*BrowserWindow\b/.test(code);
    const isMemberConstruct = /\bnew\s+electron\.BrowserWindow\s*\(/.test(code);
    if (!isRawConstruct && !isReflectConstruct && !isMemberConstruct) continue;
    const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
    if (/createBrandedBrowserWindow|newBrandedWindow/.test(context)) continue;
    offences.push(`${label}:${i + 1}  ${line.trim()}`);
  }
  // Naive alias check: flag any `= BrowserWindow;` assignment outside
  // the whitelist. Codex round-3 listed this as a theoretical escape;
  // catching the pattern preempts even the appearance.
  const aliasOffences = src
    .split("\n")
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => /=\s*BrowserWindow\s*;/.test(line))
    .map(({ line, idx }) => `${label}:${idx + 1}  ${line.trim()}`);
  assert.equal(
    [...offences, ...aliasOffences].length,
    0,
    `raw 'new BrowserWindow(' / Reflect.construct / alias callsite(s) must go through createBrandedBrowserWindow:\n${[...offences, ...aliasOffences].join("\n")}`
  );
}

// Whitelist: brand-icons.mjs is the single file allowed to raw-
// construct BrowserWindow (it's the wrapper). Walk all .mjs/.cjs/.js
// under src/desktop/ — round-4 widened the scan from "two specific
// files" so future native consumers can't add a raw constructor
// in a new module without tripping the gate.
const desktopFiles = walkJsFiles(path.join(root, "src/desktop"));
const BRAND_HELPER_WHITELIST = new Set([BRAND_ICONS_PATH]);
for (const filePath of desktopFiles) {
  if (BRAND_HELPER_WHITELIST.has(filePath)) continue;
  const src = readFileSync(filePath, "utf8");
  if (!/\bnew BrowserWindow\s*\(|Reflect\.construct\s*\(\s*BrowserWindow\b|\bnew\s+electron\.BrowserWindow\s*\(/.test(src)) continue;
  const relLabel = path.relative(root, filePath).replaceAll("\\", "/");
  assertBrowserWindowSitesAreBranded(src, relLabel);
}

// (d) Tray icon goes through composeTrayIcon, not legacy indigo orb.
//     Reject the legacy color / gradient signature anywhere in
//     electron-main.mjs (the orb literal must not regress).
const orbSignatures = [
  "#6366f1",          // indigo top
  "#312e81",          // indigo mid
  "#0f0f1a",          // dark base
  'id="base"',        // <radialGradient id="base">
  '<!-- orb base -->'
];
for (const sig of orbSignatures) {
  assert.ok(
    !electronMainSrc.includes(sig),
    `electron-main.mjs must not contain legacy indigo-orb tray signature '${sig}' — round-2 left this as the tray placeholder`
  );
}
// And the tray must call composeTrayIcon at construction + update sites.
assert.ok(
  /new Tray\s*\(\s*brandIcons\.composeTrayIcon\(/.test(electronMainSrc),
  "tray must be constructed via brandIcons.composeTrayIcon"
);
assert.ok(
  /tray\.setImage\s*\(\s*brandIcons\.composeTrayIcon\(/.test(electronMainSrc),
  "tray badge updates must go through brandIcons.composeTrayIcon"
);

// (e) Notification fallback uses createBrandedNotification.
//     Whitelist: brand-icons.mjs (the wrapper helper itself).
//     Walk all desktop files for raw `new Notification(` /
//     reflective construct / member-call.
function assertNotificationsAreBranded(src, label) {
  const lines = src.split("\n");
  const offences = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/^\s*\/\/.*$/, "");
    const isRaw = /\bnew Notification\s*\(/.test(code);
    const isMember = /\bnew\s+electron\.Notification\s*\(/.test(code);
    const isReflect = /Reflect\.construct\s*\(\s*Notification\b/.test(code);
    if (!isRaw && !isMember && !isReflect) continue;
    const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (/createBrandedNotification/.test(context)) continue;
    offences.push(`${label}:${i + 1}  ${lines[i].trim()}`);
  }
  assert.equal(
    offences.length,
    0,
    `raw 'new Notification(' callsite(s) must go through createBrandedNotification:\n${offences.join("\n")}`
  );
}
for (const filePath of desktopFiles) {
  if (BRAND_HELPER_WHITELIST.has(filePath)) continue;
  const src = readFileSync(filePath, "utf8");
  if (!/\bnew Notification\s*\(|Reflect\.construct\s*\(\s*Notification\b|\bnew\s+electron\.Notification\s*\(/.test(src)) continue;
  const relLabel = path.relative(root, filePath).replaceAll("\\", "/");
  assertNotificationsAreBranded(src, relLabel);
}

// (f) dialog.showMessageBox is a brand surface (the dialog header
//     carries the app icon on Windows). Round-4 codex flagged this
//     as a missed surface: link-open ask dialog used raw
//     `dialog.showMessageBox(...)`. The wrapper
//     `brandIcons.showBrandedMessageBox(dialog, ...)` defaults the
//     icon. Whitelist: brand-icons.mjs.
function assertMessageBoxesAreBranded(src, label) {
  const lines = src.split("\n");
  const offences = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/^\s*\/\/.*$/, "");
    if (!/\bdialog\.showMessageBox\s*\(/.test(code)) continue;
    const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (/showBrandedMessageBox/.test(context)) continue;
    offences.push(`${label}:${i + 1}  ${lines[i].trim()}`);
  }
  assert.equal(
    offences.length,
    0,
    `raw 'dialog.showMessageBox(' callsite(s) must go through brandIcons.showBrandedMessageBox:\n${offences.join("\n")}`
  );
}
for (const filePath of desktopFiles) {
  if (BRAND_HELPER_WHITELIST.has(filePath)) continue;
  const src = readFileSync(filePath, "utf8");
  if (!/\bdialog\.showMessageBox\s*\(/.test(src)) continue;
  const relLabel = path.relative(root, filePath).replaceAll("\\", "/");
  assertMessageBoxesAreBranded(src, relLabel);
}

console.log(
  `ok verify-brand-assets (canonical sha256 ${canonicalSha256.slice(0, 12)}…, ` +
  `native+SVG domains)`
);
