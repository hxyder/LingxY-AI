#!/usr/bin/env node
/**
 * verify-artifact-attachment-flow.mjs — UCA-179
 *
 * Regression: a task that generates a document and is then asked to
 * email it would send the email without the attachment. Root cause —
 * neither planner surfaced the run's artifact_paths back to the LLM on
 * subsequent tool turns, so send_email / account_send_email never saw
 * an absolute path to put in attachmentPaths.
 *
 * This script pins the minimum fixes so the gap doesn't silently return:
 *   - agentic/planner.mjs seeds artifactPaths from the context packet's
 *     file_paths + image_paths.
 *   - agentic/planner.mjs appends artifact_paths to the tool-message
 *     content AND injects a running "Artifacts produced so far" note
 *     into the conversation when the set grows.
 *   - tool_using/agent-loop.mjs records artifact_paths on each
 *     tool_result transcript entry AND buildConversationMessages()
 *     rolls them up into every subsequent tool observation.
 *   - submission paths persist terminal artifact_paths on success AND
 *     partial_success, so downgraded agentic tasks still show files in
 *     Console -> Files.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const agentic = read("src/service/executors/agentic/planner.mjs");
const toolUsingAgentLoop = read("src/service/executors/tool_using/agent-loop.mjs");
const toolUsingMessages = read("src/service/executors/tool_using/conversation-messages.mjs");
const actionTools = read("src/service/capabilities/tools/file-content-tools.mjs");
const actionToolAggregator = read("src/service/action_tools/tools/index.mjs");
const writeTools = read("src/service/capabilities/connectors/tools/write-tools.mjs");
const msConnector = read("src/service/capabilities/connectors/microsoft/microsoft-connector.mjs");
const contextSubmission = read("src/service/core/context-submission.mjs");
const browserSubmission = read("src/service/core/browser-submission.mjs");
const taskRoutes = read("src/service/core/http-routes/task-routes.mjs");

// ── Backend still accepts attachmentPaths. ────────────────────────────
assert.match(writeTools, /attachmentPaths:\s*\{[^}]*type:\s*"array"/s,
  "account_send_email must still declare attachmentPaths");
assert.match(msConnector, /contentBytes:\s*content\.toString\("base64"\)/,
  "sendMicrosoftEmail must base64-encode file bytes for Graph");

// ── agentic/planner: seed + surface + running-note. ───────────────────
assert.match(agentic, /context_packet\?\.file_paths/,
  "agentic planner must seed artifactPaths from context_packet.file_paths");
assert.match(agentic, /pathsForTurn/,
  "agentic planner must build a per-turn artifact list for the tool message");
assert.match(agentic, /attachmentPaths \/ localPath \/ file/,
  "agentic planner tool-message addendum must name the target arg names");
assert.match(agentic, /Artifacts produced so far in this run/,
  "agentic planner must inject a running artifacts-so-far reminder");
assert.match(agentic, /__lastArtifactPathsHash/,
  "agentic planner must avoid duplicating the reminder each iteration");

// ── tool_using/agent-loop: transcript + conversation rollup. ──────────
assert.match(toolUsingAgentLoop, /artifact_paths:\s*Array\.isArray\(result\.artifact_paths\)/,
  "tool_using agent-loop must store artifact_paths on the transcript entry");
assert.match(toolUsingAgentLoop, /collectArtifactPathsFromTranscript/,
  "tool_using agent-loop terminal success must surface transcript artifact_paths");
assert.match(toolUsingMessages, /function buildConversationMessages\(prefixMessages,\s*transcript,\s*initialFilePaths/,
  "buildConversationMessages must accept initial file paths from the context packet");
assert.match(toolUsingMessages, /Artifacts available so far/,
  "buildConversationMessages must roll up artifacts into each tool observation");
assert.match(toolUsingAgentLoop, /context_packet\?\.file_paths/,
  "agent-loop must pass context_packet.file_paths into buildConversationMessages");
assert.match(toolUsingAgentLoop, /context_packet\?\.image_paths/,
  "agent-loop must pass context_packet.image_paths into buildConversationMessages");

// ── submission persistence: terminal artifact_paths. ─────────────────
for (const [name, source] of [
  ["context-submission", contextSubmission],
  ["browser-submission", browserSubmission]
]) {
  assert.match(source, /\["success",\s*"partial_success"\]\.includes\(event\.event_type\)[\s\S]{0,160}artifact_paths/,
    `${name} must persist artifact_paths from success and partial_success terminal events`);
  assert.match(source, /runtime\.store\.appendArtifact\(artifactRecord\)/,
    `${name} must append terminal artifact paths to the artifact store`);
}

// ── console detail recovery: already-finished tasks. ─────────────────
assert.match(taskRoutes, /function mergeArtifactsForTask\(taskId,\s*persistedArtifacts = \[\],\s*events = \[\]\)/,
  "task detail must merge stored artifacts with event-derived artifact paths");
assert.match(taskRoutes, /Array\.isArray\(payload\.artifact_paths\)[\s\S]{0,120}candidates\.push\(\.\.\.payload\.artifact_paths\)/,
  "task detail must recover artifact_paths from historical events");
assert.match(taskRoutes, /derived_from_event:\s*true/,
  "event-derived artifacts must be marked for observability");
assert.match(actionTools, /REGISTER_ARTIFACT_TOOL[\s\S]{0,1800}artifactPaths:\s*\[filePath\]/,
  "register_artifact must return artifactPaths so core submissions can persist it");
assert.match(actionToolAggregator, /from "\.\.\/\.\.\/capabilities\/tools\/file-content-tools\.mjs"/,
  "index.mjs must import file-content-tools.mjs from capabilities/tools/");

console.log("ok verify-artifact-attachment-flow");
