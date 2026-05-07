/**
 * brand-icons.mjs — C18 #B5 round-3 (native icon domain)
 *
 * Centralizes every native (Electron / OS) brand-icon callsite onto
 * a single canonical source: `assets/icons/lingxy-*.png` (+ `.ico`).
 *
 * Round-2 only covered the SVG/HTML/CSS domain; round-3 closes the
 * native domain (BrowserWindow taskbar/title icon, Tray icon,
 * Notification fallback icon, Windows AUMID grouping). The helper
 * pattern lets the verifier reject any raw `new BrowserWindow(`
 * that bypasses brand wiring — drift becomes a verifier failure
 * rather than a per-callsite review burden.
 *
 * Dependency-injected (`{ app, nativeImage }`) to mirror the rest of
 * `createElectronShellRuntime`'s test-friendly style — tests can
 * stub `nativeImage.createFromPath` without monkey-patching Electron.
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `e:\linxi\src\desktop\tray\` → repo root is three parents up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const AVAILABLE_PNG_SIZES = [16, 32, 48, 64, 128, 256, 512];

export const BRAND_AUMID = "com.uca.desktop";

/**
 * Resolve `assets/icons/` against repo root in dev and against
 * `process.resourcesPath` (or `app.getAppPath()`) when packaged. We
 * include `assets/icons/**` in `package.json` build.files, so the
 * folder is present in the asar/bundle alongside source.
 */
function resolveIconsDir({ app }) {
  const candidates = [];
  if (app && typeof app.getAppPath === "function") {
    candidates.push(path.join(app.getAppPath(), "assets", "icons"));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "assets", "icons"));
    candidates.push(path.join(process.resourcesPath, "app", "assets", "icons"));
    candidates.push(path.join(process.resourcesPath, "app.asar", "assets", "icons"));
  }
  candidates.push(path.join(REPO_ROOT, "assets", "icons"));
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "lingxy-64.png"))) {
      return dir;
    }
  }
  // Last-resort: return repo-root path even if missing so the error
  // surfaces with a path the operator can act on.
  return path.join(REPO_ROOT, "assets", "icons");
}

function nearestAvailableSize(target) {
  let best = AVAILABLE_PNG_SIZES[0];
  let bestDelta = Math.abs(target - best);
  for (const size of AVAILABLE_PNG_SIZES) {
    const delta = Math.abs(target - size);
    if (delta < bestDelta || (delta === bestDelta && size > best)) {
      best = size;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Build a `count` badge overlaid on the canonical PNG. The PNG goes
 * in via a base64 `<image>` element so the wrapper SVG can render at
 * arbitrary tray sizes; the badge geometry is the only `<circle>` /
 * `<text>` allowed (the verifier whitelists it explicitly).
 */
function composeTrayBadgeSvg({ pngBase64, size, count }) {
  const hasBadge = count > 0;
  const label = count > 99 ? "99+" : String(count);
  const badgeR = label.length > 1 ? Math.max(7, Math.round(size * 0.28)) : Math.max(5, Math.round(size * 0.22));
  const cx = size - badgeR - 1;
  const cy = badgeR + 1;
  const fontSize = label.length > 1 ? Math.max(7, Math.round(size * 0.22)) : Math.max(8, Math.round(size * 0.28));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <image href="data:image/png;base64,${pngBase64}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>
    ${hasBadge ? `<circle cx="${cx}" cy="${cy}" r="${badgeR}" fill="#22c55e"/>
    <text x="${cx}" y="${cy + Math.round(fontSize * 0.36)}" text-anchor="middle"
      font-family="system-ui,sans-serif" font-size="${fontSize}"
      font-weight="bold" fill="white">${label}</text>` : ""}
  </svg>`;
}

export function createBrandIconResolver({ app, nativeImage }) {
  if (!nativeImage || typeof nativeImage.createFromPath !== "function") {
    throw new Error("createBrandIconResolver: nativeImage binding is required");
  }
  const iconsDir = resolveIconsDir({ app });
  const cache = new Map();

  function resolveBrandIcon({ size = 64 } = {}) {
    const actual = nearestAvailableSize(size);
    const cacheKey = `png:${actual}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const filePath = path.join(iconsDir, `lingxy-${actual}.png`);
    const image = nativeImage.createFromPath(filePath);
    cache.set(cacheKey, image);
    return image;
  }

  function resolveBrandIcoPath() {
    return path.join(iconsDir, "lingxy.ico");
  }

  function composeTrayIcon({ count = 0, size = 32 } = {}) {
    // No badge → use canonical PNG directly via createFromPath. The OS
    // tray then handles DPI scaling against the source bitmap rather
    // than a fixed-size SVG bake (codex round-3 flagged the SVG-bake
    // path as 4K/200% blur risk). For badged tray we still need the
    // SVG composition, but render onto a 2x canvas so HiDPI down-
    // scale stays sharp.
    if (count <= 0) {
      return resolveBrandIcon({ size });
    }
    const renderSize = size * 2;
    const sourceSize = nearestAvailableSize(renderSize);
    const pngPath = path.join(iconsDir, `lingxy-${sourceSize}.png`);
    if (!existsSync(pngPath)) {
      return resolveBrandIcon({ size });
    }
    const pngBase64 = readFileSync(pngPath).toString("base64");
    // composeTrayBadgeSvg viewBox stays at renderSize; the icon will
    // render sharply at logical size on 1x, 2x, and 3x displays.
    const svg = composeTrayBadgeSvg({ pngBase64, size: renderSize, count });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    return nativeImage.createFromDataURL(dataUrl);
  }

  /**
   * Wrap `new BrowserWindow(options)` to inject the canonical icon.
   * Every Electron BrowserWindow callsite must go through this so
   * the verifier can grep `new BrowserWindow(` and reject raw use.
   */
  function createBrandedBrowserWindow(BrowserWindow, options = {}) {
    const merged = { ...options };
    if (!("icon" in merged)) {
      // .ico is preferred on Windows (carries multiple sizes for
      // taskbar/title-bar/jumplist). nativeImage on macOS/Linux
      // accepts paths to .png as well, so .ico path is fine cross-
      // platform too — Electron will fall back gracefully.
      merged.icon = resolveBrandIcoPath();
    }
    return new BrowserWindow(merged);
  }

  /**
   * Build a Notification with brand icon defaulted in. Same wrapper
   * pattern: notification fallback was a missed surface in round-2.
   */
  function createBrandedNotification(Notification, options = {}) {
    const merged = { ...options };
    if (!("icon" in merged)) {
      merged.icon = resolveBrandIcon({ size: 64 });
    }
    return new Notification(merged);
  }

  /**
   * Wrap `dialog.showMessageBox` (or its window-scoped overload) so
   * the dialog header carries the brand icon. Codex round-4 review
   * flagged this as a missed native surface — the link-open dialog
   * was using raw `dialog.showMessageBox` without an icon, falling
   * back to the OS default. Caller signature mirrors Electron's:
   *   showBrandedMessageBox(dialog, options)
   *   showBrandedMessageBox(dialog, parentWindow, options)
   */
  function showBrandedMessageBox(dialog, ownerOrOptions, maybeOptions) {
    const hasOwner = maybeOptions !== undefined;
    const ownerWindow = hasOwner ? ownerOrOptions : undefined;
    const options = hasOwner ? maybeOptions : ownerOrOptions;
    const merged = { ...options };
    if (!("icon" in merged)) {
      merged.icon = resolveBrandIcon({ size: 64 });
    }
    if (hasOwner) {
      return dialog.showMessageBox(ownerWindow, merged);
    }
    return dialog.showMessageBox(merged);
  }

  return {
    iconsDir,
    resolveBrandIcon,
    resolveBrandIcoPath,
    composeTrayIcon,
    createBrandedBrowserWindow,
    createBrandedNotification,
    showBrandedMessageBox
  };
}
