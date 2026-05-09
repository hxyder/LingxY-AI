import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/code-ownership-map.md");

function fail(message) {
  console.error(`[code-ownership] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function walkFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkFiles(fullPath, files);
    } else if (/\.(mjs|cjs|js|ts|tsx|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.mjs"),
    path.join(base, "index.js")
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? base;
}

function importSpecifiers(source) {
  const imports = [];
  for (const match of source.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g)) imports.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) imports.push(match[1]);
  for (const match of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) imports.push(match[1]);
  return imports;
}

assert(existsSync(docPath), "missing docs/architecture/code-ownership-map.md");
const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

for (const required of [
  "src/desktop/tray/**",
  "src/desktop/renderer/**",
  "src/service/core/**",
  "src/service/action_tools/**",
  "src/shared/**",
  "src/desktop/tray/electron-main.mjs",
  "src/desktop/renderer/console.js",
  "src/desktop/renderer/overlay.js",
  "src/service/action_tools/tools/index.mjs",
  "src/service/core/http-server.mjs",
  "src/service/core/context-submission.mjs",
  "src/service/core/agent-loop.mjs"
]) {
  assert(doc.includes(required), `ownership map missing required path: ${required}`);
}

const sharedRoot = path.join(root, "src/shared");
const serviceRoot = path.join(root, "src/service");
const desktopRoot = path.join(root, "src/desktop");

for (const file of walkFiles(sharedRoot)) {
  const source = readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    assert(specifier !== "electron", `${path.relative(root, file)} imports electron`);
    const resolved = resolveRelativeImport(file, specifier);
    if (!resolved) continue;
    assert(!resolved.startsWith(serviceRoot), `${path.relative(root, file)} imports service runtime: ${specifier}`);
    assert(!resolved.startsWith(desktopRoot), `${path.relative(root, file)} imports desktop runtime: ${specifier}`);
  }
}

const rendererRoot = path.join(root, "src/desktop/renderer");
for (const file of walkFiles(rendererRoot)) {
  const source = readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveRelativeImport(file, specifier);
    if (!resolved) continue;
    assert(!resolved.startsWith(serviceRoot), `${path.relative(root, file)} imports service runtime: ${specifier}`);
  }
}

if (!process.exitCode) {
  console.log("[code-ownership] ownership map and current source boundaries verified.");
}
