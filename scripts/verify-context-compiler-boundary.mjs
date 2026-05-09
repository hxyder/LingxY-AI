import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function collectFiles(dir, predicate) {
  const absoluteDir = path.join(root, dir);
  const files = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const absolute = path.join(absoluteDir, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      files.push(...collectFiles(relative, predicate));
    } else if (entry.isFile() && predicate(relative)) {
      files.push(relative);
    }
  }
  return files;
}

const compilerPath = "src/service/core/context/context-compiler.mjs";
const compilerAbsolute = path.join(root, compilerPath);
assert.ok(existsSync(compilerAbsolute), "ContextCompiler must live in service/core/context");
assert.ok(statSync(compilerAbsolute).isFile(), "ContextCompiler path must be a file");

const compiler = read(compilerPath);
assert.match(compiler, /CONTEXT_COMPILER_OWNER\s*=\s*"service\/runtime"/,
  "ContextCompiler must declare service/runtime ownership");
assert.match(compiler, /export function compileContextForTask/,
  "ContextCompiler must export compileContextForTask");
assert.match(compiler, /recordRuntimeTiming\?\.\("context\.compile"/,
  "ContextCompiler must emit context.compile timing metrics");
assert.match(compiler, /incrementRuntimeCounter\?\.\("context\.selected_items"/,
  "ContextCompiler must emit selected item counters");
assert.match(compiler, /reason:/,
  "ContextCompiler selected items must carry inclusion reasons");
assert.doesNotMatch(compiler, /from\s+["'][^"']*src\/desktop|from\s+["'][^"']*desktop\//,
  "ContextCompiler must not import desktop modules");
assert.doesNotMatch(compiler, /\b(?:readFileSync|writeFileSync|readdirSync|execSync|spawnSync|Atomics\.wait)\b/,
  "ContextCompiler must not add blocking hot-path APIs");

const desktopFiles = collectFiles("src/desktop", (relative) => /\.(?:mjs|js|cjs)$/u.test(relative));
for (const file of desktopFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /context-compiler\.mjs|compileContextForTask|CONTEXT_COMPILER_OWNER/,
    `${file} must not import or own context compilation`);
}

const docs = read("docs/architecture/electron-js-runtime-performance-plan.md")
  + "\n"
  + read("docs/architecture/agent-runtime-spine.md");
assert.match(docs, /PR-05[\s\S]{0,220}Done/,
  "Architecture docs must mark PR-05 as done");
assert.match(docs, /ContextCompiler[\s\S]{0,220}service\/runtime/,
  "Architecture docs must record service/runtime ownership");

console.log("[verify-context-compiler-boundary] ContextCompiler service boundary verified");
