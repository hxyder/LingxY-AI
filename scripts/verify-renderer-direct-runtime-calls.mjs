import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rendererRoot = path.join(root, "src/desktop/renderer");
const docPath = path.join(root, "docs/architecture/ipc-contract-inventory.md");

const expectedCallSites = {
  "src/desktop/renderer/dock-shell-client.mjs": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/echo-bubble-shell-client.js": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/live-preview-shell-client.js": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/popup-card-shell-client.js": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/preview/shell-preview-client.js": { fetchCount: 0, shellCount: 1 },
  "src/desktop/renderer/shared/shell-client.mjs": { fetchCount: 0, shellCount: 1 }
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

function stripJsComments(source) {
  let out = "";
  let i = 0;
  let state = "code";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === "lineComment") {
      if (ch === "\n") {
        out += ch;
        state = "code";
      }
      i++;
      continue;
    }
    if (state === "blockComment") {
      if (ch === "*" && next === "/") {
        i += 2;
        state = "code";
        continue;
      }
      if (ch === "\n") out += ch;
      i++;
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      out += ch;
      if (ch === "\\") {
        if (i + 1 < source.length) out += source[i + 1];
        i += 2;
        continue;
      }
      if ((state === "single" && ch === "'")
          || (state === "double" && ch === "\"")
          || (state === "template" && ch === "`")) {
        state = "code";
      }
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      state = "lineComment";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "blockComment";
      i += 2;
      continue;
    }
    if (ch === "'") state = "single";
    else if (ch === "\"") state = "double";
    else if (ch === "`") state = "template";
    out += ch;
    i++;
  }
  return out;
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
  const code = stripJsComments(source);
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const fetchCount = countMatches(code, /\bfetch\s*\(/g);
  const shellCount = countMatches(code, /window\.ucaShell/g);
  if (fetchCount || shellCount) actual[rel] = { fetchCount, shellCount };
}

assert(stableJson(actual) === stableJson(expectedCallSites), "renderer direct runtime call snapshot changed; update inventory intentionally.");

const totals = Object.values(actual).reduce((acc, entry) => ({
  fetchCount: acc.fetchCount + entry.fetchCount,
  shellCount: acc.shellCount + entry.shellCount
}), { fetchCount: 0, shellCount: 0 });
assert(totals.fetchCount === 0, "renderer direct fetch count changed");
assert(totals.shellCount === 6, "renderer window.ucaShell reference count changed");

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("Renderer Direct Runtime Call Snapshot"), "IPC inventory missing renderer direct runtime call snapshot");
assert(doc.includes("Direct renderer `fetch(` code references: 0"), "IPC inventory missing renderer fetch total");
assert(doc.includes("Direct renderer `window.ucaShell` references: 6"), "IPC inventory missing renderer shell total");

if (!process.exitCode) {
  console.log("[renderer-runtime-calls] renderer direct runtime call snapshot verified.");
}
