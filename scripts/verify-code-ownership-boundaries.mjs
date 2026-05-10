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

function normalizeForCompare(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
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
  "src/desktop/console/**",
  "src/desktop/overlay/**",
  "src/service/core/**",
  "src/service/executors/**",
  "src/service/action_tools/**",
  "src/shared/**",
  "src/desktop/tray/electron-main.mjs",
  "src/desktop/renderer/console.js",
  "src/desktop/renderer/overlay.js",
  "src/service/action_tools/tools/index.mjs",
  "src/service/core/http-server.mjs",
  "src/service/core/context-submission.mjs",
  "src/service/executors/tool_using/agent-loop.mjs",
  "src/service/executors/agentic/planner.mjs"
]) {
  assert(doc.includes(required), `ownership map missing required path: ${required}`);
}

const sharedRoot = path.join(root, "src/shared");
const serviceRoot = path.join(root, "src/service");
const desktopRoot = path.join(root, "src/desktop");
const desktopUiRoots = [
  path.join(root, "src/desktop/renderer"),
  path.join(root, "src/desktop/console"),
  path.join(root, "src/desktop/overlay")
];
const allowedDesktopServiceImports = new Map([
  [
    normalizeForCompare(path.join(root, "src/desktop/console/runtime-client.mjs")),
    new Set([normalizeForCompare(path.join(root, "src/service/cost/pricing.mjs"))])
  ]
]);

for (const file of walkFiles(sharedRoot)) {
  const source = readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    assert(specifier !== "electron", `${path.relative(root, file)} imports electron`);
    const resolved = resolveRelativeImport(file, specifier);
    if (!resolved) continue;
    assert(!isWithin(resolved, serviceRoot), `${path.relative(root, file)} imports service runtime: ${specifier}`);
    assert(!isWithin(resolved, desktopRoot), `${path.relative(root, file)} imports desktop runtime: ${specifier}`);
  }
}

for (const desktopUiRoot of desktopUiRoots) {
  for (const file of walkFiles(desktopUiRoot)) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (!resolved) continue;
      const allowedImports = allowedDesktopServiceImports.get(normalizeForCompare(file));
      const isAllowed = allowedImports?.has(normalizeForCompare(resolved)) === true;
      assert(
        isAllowed || !isWithin(resolved, serviceRoot),
        `${path.relative(root, file)} imports service runtime: ${specifier}`
      );
    }
  }
}

if (!process.exitCode) {
  console.log("[code-ownership] ownership map and current source boundaries verified.");
}
