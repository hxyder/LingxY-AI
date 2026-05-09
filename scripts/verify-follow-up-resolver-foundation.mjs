import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

const resolver = read("src/service/core/session/follow-up-resolver.mjs");
const taskRecord = read("src/service/core/task-runtime/task-record.mjs");
const lifecycle = read("src/service/core/task-runtime/conversation-lifecycle.mjs");
const routes = read("src/service/core/http-routes/task-routes.mjs");
const taskRuntime = read("src/service/core/task-runtime.mjs");
const testSource = read("tests/behavior/follow-up-resolver.test.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(resolver, /FOLLOW_UP_RESOLVER_SCHEMA_VERSION/, "resolver must version its contract");
assert.match(resolver, /resolveFollowUp/, "resolver must export resolveFollowUp");
assert.match(resolver, /looksLikeFollowUpSignal/, "resolver must own follow-up signal detection");
assert.match(resolver, /SESSION_ITEM_KINDS/, "resolver must read typed session item kinds");
assert.match(resolver, /TASK_ANCHOR/, "resolver must support task anchors");
assert.match(resolver, /TOOL_OBSERVATION/, "resolver must support tool observations");
assert.match(resolver, /session_anchor/, "resolver must report session anchor mode");
assert.doesNotMatch(resolver, /listTasks\(/, "resolver must not use legacy task-list scans");
assert.doesNotMatch(resolver, /src\/desktop|desktop\//, "resolver must stay out of desktop code");

assert.match(taskRecord, /resolveFollowUp/, "task records must use FollowUpResolver");
assert.match(taskRecord, /follow_up_resolution/, "task records must persist resolver decisions in context metadata");
assert.doesNotMatch(taskRecord, /resolveParentFromConversation|shouldAutoResolveParentFromConversation/,
  "task records must not call old follow-up lifecycle helpers");
assert.doesNotMatch(lifecycle, /resolveParentFromConversation|shouldAutoResolveParentFromConversation/,
  "conversation lifecycle must not retain old follow-up resolver exports");
assert.match(routes, /looksLikeFollowUpSignal/, "HTTP task route must use the new resolver signal contract");
assert.match(taskRuntime, /resolveFollowUp/, "task-runtime barrel must expose the new resolver");

assert.match(testSource, /latest typed session task anchor/, "tests must cover session anchor resolution");
assert.match(testSource, /standalone new-topic requests/, "tests must cover non-follow-up requests");
assert.match(testSource, /caller-provided parent wins/, "tests must cover explicit parent precedence");
assert.match(testSource, /task record creation uses FollowUpResolver/, "tests must cover task-record wiring");

assert.match(docs, /CX-003[\s\S]{0,220}Done/, "runtime spine must mark CX-003 done");
assert.match(docs, /new framework path[\s\S]{0,240}retire old/, "docs must require replacement over parallel legacy paths");

console.log("[verify-follow-up-resolver-foundation] FollowUpResolver foundation verified");
