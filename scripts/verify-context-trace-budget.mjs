#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

function walkFiles(relativeDir) {
  const start = path.join(root, relativeDir);
  if (!existsSync(start)) return [];
  const files = [];
  for (const entry of readdirSync(start, { withFileTypes: true })) {
    const fullPath = path.join(start, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      files.push(...walkFiles(relativePath));
    } else if (/\.(?:mjs|js|cjs)$/u.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

const docPath = "docs/architecture/context-trace-budget.md";
assert.ok(existsSync(path.join(root, docPath)), "RT-003 context trace budget doc missing");
const doc = read(docPath);

for (const required of [
  "# Context Trace Budget",
  "RT-003",
  "Current Canonical Trace Storage",
  "compact task metadata is the canonical context trace storage",
  "RT-003 does not add `context_compile_traces`",
  "Budget Contract",
  "Read And Write Boundaries",
  "Reconsideration Gate",
  "Verification"
]) {
  assert.ok(doc.includes(required), `context trace budget doc missing: ${required}`);
}

const command = "node scripts/verify-context-trace-budget.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include context trace budget verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include context trace budget verifier");

const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");
assert.ok(roadmap.includes("RT-003"), "post-runtime roadmap must track RT-003");
assert.ok(roadmap.includes("docs/architecture/context-trace-budget.md"),
  "post-runtime roadmap must link the RT-003 context trace decision");
assert.ok(roadmap.includes("compact task metadata is the canonical context trace storage"),
  "post-runtime roadmap must record the RT-003 compact trace decision");

const schema = read("src/service/core/store/sqlite-schema.mjs");
const sqliteStore = read("src/service/core/store/sqlite-store.mjs");
assert.doesNotMatch(schema, /context_compile_traces/u,
  "RT-003 must not add a context_compile_traces table to SQLite schema");
assert.doesNotMatch(sqliteStore, /context_compile_traces|appendContextCompileTrace|insertContextCompileTrace/u,
  "RT-003 must not add context trace write methods to sqlite-store");

const compiler = read("src/service/core/context/context-compiler.mjs");
for (const required of [
  "maxItems: 32",
  "maxTextChars: 8000",
  "maxOmissions: 64",
  "sessionItemLimit: 200",
  "artifactExtractLimit: 24",
  "perArtifactExtractLimit: 4"
]) {
  assert.ok(compiler.includes(required), `ContextCompiler default budget missing ${required}`);
}
assert.match(compiler, /debug = false/u, "ContextCompiler must default debug traces off");
assert.match(compiler, /if \(debug\) \{[\s\S]{0,120}compiled\.debug_trace =/u,
  "ContextCompiler must emit full candidate traces only when debug is true");
assert.match(compiler, /omissions: omissions\.slice\(0, limits\.maxOmissions\)/u,
  "ContextCompiler omissions must be bounded");
assert.match(compiler, /recordRuntimeTiming\?\.\("context\.compile"/u,
  "ContextCompiler must keep context.compile timing metrics");
assert.doesNotMatch(compiler, /\b(?:appendContext|insertContext|context_compile_traces|updateTask|insertTask|appendSessionItem|appendEvent)\b/u,
  "ContextCompiler must remain read-only for persistence");

const taskRecord = read("src/service/core/task-runtime/task-record.mjs");
assert.match(taskRecord, /compileContextForTask/u, "task creation must run ContextCompiler");
assert.match(taskRecord, /compiled_context:\s*compiledContext/u,
  "task creation must stamp compiled_context into task context metadata");
assert.match(taskRecord, /context_compile_error/u,
  "task creation must keep context compile failure fail-soft");

const detailRenderer = read("src/desktop/renderer/console-task-detail.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
assert.match(detailRenderer, /selectedLimit/u, "context debug selected list must stay bounded");
assert.match(detailRenderer, /omittedLimit/u, "context debug omitted list must stay bounded");
assert.match(detailRenderer, /data-context-debug-copy="1"/u,
  "context debug full JSON must be copy-triggered");
assert.doesNotMatch(detailRenderer, /data-context-debug-json/u,
  "context debug full JSON must not be embedded in DOM attributes");
assert.match(consoleJs, /copySelectedTaskContextDebugJson/u,
  "console must lazy-copy full context JSON on demand");
assert.match(consoleJs, /JSON\.stringify\(compiledContext,\s*null,\s*2\)/u,
  "console must serialize full context JSON only in the copy handler");

for (const file of walkFiles("src/desktop")) {
  const source = read(file);
  assert.doesNotMatch(source, /context-compiler\.mjs|compileContextForTask|CONTEXT_COMPILER_OWNER/u,
    `${file} must not import or run ContextCompiler`);
}

const contextCompilerTests = read("tests/behavior/context-compiler.test.mjs");
assert.match(contextCompilerTests, /compact default traces/u,
  "context compiler tests must cover compact default traces");
assert.match(contextCompilerTests, /compiled\.debug_trace, undefined/u,
  "context compiler tests must prove debug_trace is absent by default");

console.log("[context-trace-budget] RT-003 context trace budget verified");
