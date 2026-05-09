import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rendererRoot = path.join(root, "src/desktop/renderer");
const docPath = path.join(root, "docs/architecture/ipc-contract-inventory.md");

const expectedCallSites = {
  "src/desktop/renderer/console-file-content-index-panel.mjs": { fetchCount: 1, shellCount: 0 },
  "src/desktop/renderer/console.js": { fetchCount: 18, shellCount: 209 },
  "src/desktop/renderer/conversation-cache.mjs": { fetchCount: 1, shellCount: 0 },
  "src/desktop/renderer/dock.js": { fetchCount: 2, shellCount: 46 },
  "src/desktop/renderer/echo-bubble.js": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/live-preview.js": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/overlay.js": { fetchCount: 4, shellCount: 97 },
  "src/desktop/renderer/popup-card.js": { fetchCount: 0, shellCount: 8 },
  "src/desktop/renderer/preview-window.js": { fetchCount: 0, shellCount: 5 },
  "src/desktop/renderer/preview/handlers/csv.js": { fetchCount: 0, shellCount: 2 },
  "src/desktop/renderer/preview/handlers/iframe-remote.js": { fetchCount: 1, shellCount: 0 },
  "src/desktop/renderer/preview/handlers/image.js": { fetchCount: 0, shellCount: 2 },
  "src/desktop/renderer/preview/handlers/pdf.js": { fetchCount: 0, shellCount: 2 },
  "src/desktop/renderer/preview/handlers/text.js": { fetchCount: 0, shellCount: 2 },
  "src/desktop/renderer/task-event-stream.js": { fetchCount: 1, shellCount: 0 }
};

function fail(message) {
  console.error(`[renderer-runtime-calls] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (/\.(mjs|js|cjs)$/.test(entry.name) && entry.name !== "preload.cjs") {
      files.push(fullPath);
    }
  }
  return files;
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function stableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = value[key];
  return JSON.stringify(ordered);
}

const actual = {};
for (const file of walkFiles(rendererRoot)) {
  const source = readFileSync(file, "utf8");
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const fetchCount = countMatches(source, /\bfetch\s*\(/g);
  const shellCount = countMatches(source, /window\.ucaShell/g);
  if (fetchCount || shellCount) actual[rel] = { fetchCount, shellCount };
}

assert(stableJson(actual) === stableJson(expectedCallSites), "renderer direct runtime call snapshot changed; update inventory intentionally.");

const totals = Object.values(actual).reduce((acc, entry) => ({
  fetchCount: acc.fetchCount + entry.fetchCount,
  shellCount: acc.shellCount + entry.shellCount
}), { fetchCount: 0, shellCount: 0 });
assert(totals.fetchCount === 28, "renderer direct fetch count changed");
assert(totals.shellCount === 375, "renderer window.ucaShell reference count changed");

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("Renderer Direct Runtime Call Snapshot"), "IPC inventory missing renderer direct runtime call snapshot");
assert(doc.includes("Direct renderer `fetch(` references: 28"), "IPC inventory missing renderer fetch total");
assert(doc.includes("Direct renderer `window.ucaShell` references: 375"), "IPC inventory missing renderer shell total");

if (!process.exitCode) {
  console.log("[renderer-runtime-calls] renderer direct runtime call snapshot verified.");
}
