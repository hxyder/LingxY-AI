#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const docPath = "docs/architecture/sqlite-write-path-budget.md";
assert.ok(existsSync(path.join(root, docPath)), "RT-001 SQLite write-path budget doc missing");
const doc = read(docPath);

for (const required of [
  "# SQLite Write Path Budget",
  "RT-001",
  "Current Store Owners",
  "Current Write-Path Inventory",
  "Priority Classes",
  "Queue Decision",
  "keep direct service-owned SQLite writes",
  "Future Queue Requirements",
  "Guardrails",
  "RT-002 starts from this decision"
]) {
  assert.ok(doc.includes(required), `SQLite write-path budget doc missing: ${required}`);
}

for (const requiredOwner of [
  "src/service/core/store/sqlite-store.mjs",
  "src/service/core/store/sqlite-schema.mjs",
  "src/service/core/store/search-index.mjs",
  "src/service/core/store/migrations/*.mjs",
  "src/service/core/persistent-runtime.mjs",
  "src/service/core/service-bootstrap.mjs"
]) {
  assert.ok(doc.includes(requiredOwner), `SQLite write-path budget doc missing owner: ${requiredOwner}`);
}

const command = "node scripts/verify-sqlite-write-path-budget.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include SQLite write-path verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include SQLite write-path verifier");

const schema = read("src/service/core/store/sqlite-schema.mjs");
assert.match(schema, /ownership:\s*"service-only"/u, "SQLite manifest must keep service-only ownership");
assert.match(schema, /writeMode:\s*"wal"/u, "SQLite manifest must keep WAL write mode");
assert.match(schema, /eventPersistenceOrder:\s*"persist-before-broadcast"/u,
  "SQLite manifest must keep event persistence order documented");

const sqliteStore = read("src/service/core/store/sqlite-store.mjs");
assert.match(sqliteStore, /import Database from "better-sqlite3"/u,
  "sqlite-store must remain the product better-sqlite3 owner");
assert.match(sqliteStore, /db\.pragma\("journal_mode = WAL"\)/u,
  "sqlite-store must set WAL mode");
assert.match(sqliteStore, /appendEvent\(event\)[\s\S]{0,240}statements\.insertEvent\.run/u,
  "sqlite-store appendEvent must own task event persistence");

const eventEmitter = read("src/service/core/task-runtime/event-emitter.mjs");
for (const eventType of [
  "text_delta",
  "tool_input_delta",
  "reasoning_delta",
  "tool_planner_decision"
]) {
  assert.match(eventEmitter, new RegExp(`EPHEMERAL_EVENT_TYPES[\\s\\S]*"${eventType}"`, "u"),
    `event emitter must keep ${eventType} out of SQLite appendEvent`);
}
assert.match(eventEmitter, /if \(!EPHEMERAL_EVENT_TYPES\.has\(eventType\)\) \{[\s\S]{0,80}runtime\.store\.appendEvent\(record\)/u,
  "event emitter must guard SQLite appendEvent with EPHEMERAL_EVENT_TYPES");

const eventLog = read("src/service/core/task-runtime/event-log.mjs");
for (const eventType of ["text_delta", "tool_input_delta", "reasoning_delta"]) {
  assert.match(eventLog, new RegExp(`JSONL_SKIP_EVENT_TYPES[\\s\\S]*"${eventType}"`, "u"),
    `JSONL task log must skip ${eventType}`);
}
assert.match(eventLog, /appendFile\(file, JSON\.stringify\(record\) \+ "\\n", "utf8"\)/u,
  "task JSONL writes must remain async appendFile writes");
assert.match(eventLog, /\.catch\(\(\) => \{ \/\* swallow; log is best-effort \*\/ \}\)/u,
  "task JSONL writes must remain best-effort");

const productFiles = walkFiles("src");
const betterSqliteUsers = productFiles.filter((file) => read(file).includes("better-sqlite3"));
assert.deepEqual(
  betterSqliteUsers,
  ["src/service/core/store/sqlite-store.mjs"],
  `product better-sqlite3 imports must remain store-owned; found ${betterSqliteUsers.join(", ")}`
);

const desktopFiles = walkFiles("src/desktop");
for (const file of desktopFiles) {
  const source = read(file);
  assert.equal(/better-sqlite3|createSqliteStore|sqlite-store\.mjs|sqlite-schema\.mjs/u.test(source), false,
    `${file} must not import or create SQLite/store internals`);
  assert.equal(/\bdb\.prepare\s*\(/u.test(source), false,
    `${file} must not own DB prepare calls`);
}

for (const requiredPath of [
  "src/service/core/store/sqlite-store.mjs",
  "src/service/core/store/sqlite-schema.mjs",
  "src/service/core/store/search-index.mjs",
  "src/service/core/store/migrations/conversation_v1.mjs",
  "src/service/core/persistent-runtime.mjs",
  "src/service/core/service-bootstrap.mjs"
]) {
  assert.ok(statSync(path.join(root, requiredPath)).isFile(), `required SQLite owner missing: ${requiredPath}`);
}

console.log("[sqlite-write-path-budget] RT-001 SQLite write-path budget verified");
