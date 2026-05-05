import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(await readFile(path.join(repoRoot, "browser_ext", "manifest.json"), "utf8"));
const selectionCacheSource = await readFile(path.join(repoRoot, "browser_ext", "content_script", "selection-cache.js"), "utf8");
const shadowFloatingChipSource = await readFile(path.join(repoRoot, "browser_ext", "shadow_ui", "floating-chip.js"), "utf8");

assert.deepEqual(manifest.content_scripts[0].js, [
  "content_script/rules.js",
  "content_script/placement.js",
  "content_script/stability-watcher.js",
  "content_script/selection-cache.js"
]);
assert.deepEqual(manifest.content_scripts[1].js, [
  "content_script/page-source-capture.js"
]);
assert.equal(manifest.content_scripts[1].world, "MAIN",
  "page-source-capture must run in MAIN world to access YouTube's ytInitialPlayerResponse");

const context = {
  __ucaOverlay: {},
  globalThis: null,
  innerWidth: 400,
  innerHeight: 260,
  visualViewport: {
    width: 400,
    height: 260
  },
  setTimeout,
  clearTimeout
};
context.globalThis = context;
vm.createContext(context);

for (const relativePath of [
  "browser_ext/content_script/rules.js",
  "browser_ext/content_script/placement.js",
  "browser_ext/content_script/stability-watcher.js"
]) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

const overlay = context.__ucaOverlay;
assert.equal(typeof overlay.computeFloatingChipPlacement, "function");
assert.equal(typeof overlay.createStabilityWatcher, "function");
assert.equal(overlay.DEFAULT_OVERLAY_SETTINGS.displayMode, "smart");
assert.equal(selectionCacheSource.includes("width:max-content"), true,
  "hover chip host must reserve its own width so page CSS cannot shrink it into scrollbars");
assert.equal(selectionCacheSource.includes("overflow:visible"), true,
  "hover chip host must keep shadow content visible instead of clipping into scrollbars");
assert.equal(selectionCacheSource.includes("contain:layout style paint"), true,
  "hover chip host must isolate layout/style/paint from the host page");
assert.equal(shadowFloatingChipSource.includes("host.style.width = \"max-content\""), true,
  "shared floating chip host must use a stable max-content box");
assert.equal(shadowFloatingChipSource.includes("host.style.overflow = \"visible\""), true,
  "shared floating chip host must not clip its shadow button");

const flipped = overlay.computeFloatingChipPlacement({
  left: 300,
  right: 390,
  top: 220,
  bottom: 240,
  width: 90,
  height: 20
});
assert.equal(flipped.horizontalPlacement, "left");
assert.equal(flipped.verticalPlacement, "above");

assert.equal(overlay.isRectVisible({
  left: 10,
  right: 40,
  top: 20,
  bottom: 60,
  width: 30,
  height: 40
}), true);

const allowed = overlay.shouldShowFloatingChip({
  state: {
    text: "this is a stable browser selection",
    selectionKey: "key-1",
    rect: { left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30 }
  },
  settings: {
    displayMode: "smart"
  },
  environment: {
    presenterMode: false,
    hostname: "github.com",
    activeElement: {
      closest() {
        return null;
      }
    }
  },
  dismissedKeys: new Set(),
  isVisibleRect: () => true
});
assert.equal(allowed.show, true);

const blocked = overlay.shouldShowFloatingChip({
  state: {
    text: "this is a stable browser selection",
    selectionKey: "key-2",
    rect: { left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30 }
  },
  settings: {
    displayMode: "smart",
    blockedDomains: ["mail.google.com"]
  },
  environment: {
    presenterMode: false,
    hostname: "mail.google.com",
    activeElement: {
      closest() {
        return null;
      }
    }
  },
  dismissedKeys: new Set(),
  isVisibleRect: () => true
});
assert.equal(blocked.reason, "domain_blocked");

const manual = overlay.shouldShowFloatingChip({
  state: {
    text: "manual mode should suppress",
    selectionKey: "key-3",
    rect: { left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30 }
  },
  settings: {
    displayMode: "manual"
  },
  environment: {
    presenterMode: false,
    hostname: "github.com",
    activeElement: {
      closest() {
        return null;
      }
    }
  },
  dismissedKeys: new Set(),
  isVisibleRect: () => true
});
assert.equal(manual.reason, "manual_mode");

const stableEvents = [];
const watcher = overlay.createStabilityWatcher({
  stabilityMs: 40,
  onStable(state) {
    stableEvents.push(state.text);
  }
});
watcher.observe({
  text: "first",
  rect: { left: 10, top: 10, width: 20, height: 20 }
});
watcher.observe({
  text: "second",
  rect: { left: 10, top: 10, width: 20, height: 20 }
});
await new Promise((resolve) => setTimeout(resolve, 70));
assert.deepEqual(stableEvents, ["second"]);

console.log("Browser overlay rules and placement verification passed.");
