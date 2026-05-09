import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const schema = read("src/service/core/store/sqlite-schema.mjs");
const memoryStore = read("src/service/core/store/memory-store.mjs");
const sqliteStore = read("src/service/core/store/sqlite-store.mjs");
const service = read("src/service/core/session/conversation-session-service.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const taskSubmission = read("src/service/core/task-runtime/task-submission.mjs");
const eventEmitter = read("src/service/core/task-runtime/event-emitter.mjs");
const compiler = read("src/service/core/context/context-compiler.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(schema, /conversation_sessions/, "sqlite schema must include conversation_sessions");
assert.match(schema, /session_items/, "sqlite schema must include session_items");
assert.match(schema, /idx_session_items_order/, "sqlite schema must index session item order");

for (const [name, source] of [
  ["memory-store", memoryStore],
  ["sqlite-store", sqliteStore]
]) {
  assert.match(source, /upsertConversationSession/, `${name} must store conversation sessions`);
  assert.match(source, /appendSessionItem/, `${name} must append session items`);
  assert.match(source, /listSessionItems/, `${name} must list ordered session items`);
}

assert.match(service, /CONVERSATION_SESSION_SCHEMA_VERSION/, "session service must version its schema");
assert.match(service, /recordTaskSubmission/, "session service must expose task submission recording");
assert.match(service, /recordTaskEvent/, "session service must expose task event recording");
assert.match(service, /USER_MESSAGE/, "session service must define user_message item kind");
assert.match(service, /TASK_ANCHOR/, "session service must define task_anchor item kind");
assert.match(service, /TOOL_CALL/, "session service must define tool_call item kind");
assert.match(service, /TOOL_OBSERVATION/, "session service must define tool_observation item kind");
assert.match(service, /tool_call_started[\s\S]*tool_call_completed/, "session service must map tool events");
assert.doesNotMatch(service, /src\/desktop|desktop\//, "session service must not import desktop code");

assert.match(runtimeServices, /createConversationSessionService/, "runtime services must create the session service");
assert.match(taskSubmission, /recordTaskSubmission/, "task submission must record session items when service is present");
assert.match(eventEmitter, /recordTaskEvent/, "event emitter must offer tool events to the session service");
assert.match(eventEmitter, /Session observability must never break tool execution or streaming/,
  "session event recording must be fail-soft");

assert.doesNotMatch(compiler, /conversation_messages/, "ContextCompiler must not scrape visible chat tables directly");
assert.match(docs, /CX-001[\s\S]{0,220}Done/, "runtime spine must mark CX-001 done");
assert.match(docs, /ConversationSession[\s\S]{0,260}session_items/, "docs must describe ConversationSession item storage");

console.log("[verify-conversation-session-foundation] ConversationSession foundation verified");
