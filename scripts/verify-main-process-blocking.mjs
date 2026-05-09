import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const mainSurfaceRoots = [
  path.join(repoRoot, "index.cjs"),
  path.join(repoRoot, "src", "desktop", "tray")
];

const bannedSyncApis = [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "readdirSync",
  "statSync",
  "lstatSync",
  "existsSync",
  "execSync",
  "execFileSync",
  "spawnSync",
  "Atomics.wait"
];

function walkJsFiles(target) {
  const files = [];
  const stat = readdirOrFile(target);
  if (stat === "file") return [target];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (/\.(?:mjs|js|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function readdirOrFile(target) {
  return /\.(?:mjs|js|cjs)$/.test(target) ? "file" : "dir";
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function matchingParenOffset(source, openOffset) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openOffset; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectIpcHandlers(source) {
  const handlers = [];
  const pattern = /ipcMain\.handle\s*\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const open = source.indexOf("(", match.index);
    const close = matchingParenOffset(source, open);
    if (close < 0) continue;
    const body = source.slice(open + 1, close);
    const startLine = lineForOffset(source, match.index);
    const endLine = lineForOffset(source, close);
    handlers.push({ startLine, endLine, body });
    pattern.lastIndex = close + 1;
  }
  return handlers;
}

function hasAwaitInLoopBlock(source, loopOffset) {
  const openBrace = source.indexOf("{", loopOffset);
  if (openBrace < 0) return false;
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return /\bawait\b/.test(source.slice(openBrace, i + 1));
      }
    }
  }
  return false;
}

function collectBlockingFindings(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const source = stripComments(raw);
  const relativePath = path.relative(repoRoot, filePath).replaceAll("\\", "/");
  const findings = [];

  for (const api of bannedSyncApis) {
    const escaped = api.replace(".", "\\.");
    const pattern = new RegExp(`\\b${escaped}\\b`, "g");
    let match;
    while ((match = pattern.exec(source))) {
      findings.push(`${relativePath}:${lineForOffset(source, match.index)} sync API '${api}' is not allowed in Electron main/tray surface`);
    }
  }

  const busyLoopPatterns = [
    /while\s*\(\s*Date\.now\(\)\s*</g,
    /while\s*\(\s*performance\.now\(\)\s*</g,
    /for\s*\(\s*;\s*;\s*\)/g
  ];
  for (const pattern of busyLoopPatterns) {
    let match;
    while ((match = pattern.exec(source))) {
      if (!hasAwaitInLoopBlock(source, match.index)) {
        findings.push(`${relativePath}:${lineForOffset(source, match.index)} potential busy loop in Electron main/tray surface`);
      }
    }
  }

  for (const handler of collectIpcHandlers(source)) {
    const lineCount = handler.endLine - handler.startLine + 1;
    if (lineCount > 90) {
      findings.push(`${relativePath}:${handler.startLine} IPC handler spans ${lineCount} lines; move heavy logic behind service/runtime boundary`);
    }
    for (const api of bannedSyncApis) {
      const escaped = api.replace(".", "\\.");
      if (new RegExp(`\\b${escaped}\\b`).test(handler.body)) {
        findings.push(`${relativePath}:${handler.startLine} IPC handler uses sync API '${api}'`);
      }
    }
  }

  return findings;
}

const files = mainSurfaceRoots.flatMap(walkJsFiles);
const findings = files.flatMap(collectBlockingFindings);

assert.equal(
  findings.length,
  0,
  `Electron main-process blocking verifier found issues:\n${findings.join("\n")}`
);

const electronMain = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "electron-main.mjs"), "utf8");
const brandIcons = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "brand-icons.mjs"), "utf8");
assert.match(electronMain, /await brandIcons\.initialize\(\)/);
assert.match(brandIcons, /async function resolveIconsDir/);
assert.match(brandIcons, /const pngBase64Cache = new Map\(\)/);

console.log("[verify-main-process-blocking] Electron main/tray blocking guard verified");
