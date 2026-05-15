import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

const profile = read("src/service/memory/user-profile.mjs");
const routes = read("src/service/core/http-routes/config-provider-routes.mjs");
const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const tests = read("tests/behavior/user-memory-profile.test.mjs");
const compiler = read("src/service/core/context/context-compiler.mjs");
const lifecycle = read("src/service/core/task-runtime/conversation-lifecycle.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(profile, /MEMORY_TYPES/, "memory profile must define governed memory types");
assert.match(profile, /user_correction/, "memory types must include user_correction");
assert.match(profile, /rejected_assumption/, "memory types must include rejected_assumption");
assert.match(profile, /createMemoryProposal/, "memory profile must create proposals");
assert.match(profile, /proposeTaskCompletionMemory/,
  "memory profile must own generated task-completion memory policy");
assert.match(profile, /generatedTaskMemoryMode/,
  "memory profile must separate routine task history from durable memory proposals");
assert.match(profile, /approveMemoryProposal/, "memory profile must approve proposals");
assert.match(profile, /rejectMemoryProposal/, "memory profile must reject proposals");
assert.match(profile, /deleteApprovedMemory/, "memory profile must delete approved memory");
assert.match(profile, /approvedMemories/, "profile must persist approved memories");
assert.match(profile, /proposals/, "profile must persist memory proposals");
assert.match(profile, /autoApproveGenerated/, "profile must persist explicit generated-memory auto-save opt-in");
assert.match(profile, /user_opt_in_auto_memory/, "automatic approval must be marked as user opt-in");
assert.doesNotMatch(profile, /silent auto-learning|autoLearnPermanent/u,
  "memory governance must not introduce silent permanent auto-learning");

assert.match(routes, /\/config\/user-memory\/proposals/, "HTTP surface must expose memory proposals");
assert.match(routes, /approveMemoryProposal/, "HTTP surface must approve memory proposals");
assert.match(routes, /rejectMemoryProposal/, "HTTP surface must reject memory proposals");
assert.match(routes, /deleteApprovedMemory/, "HTTP surface must delete approved memory");
assert.match(routes, /requireDesktopActor[\s\S]{0,120}desktop_console/u,
  "memory governance mutations must be desktop guarded");

assert.match(consoleHtml, /userMemoryApprovedList/, "Console Settings must show approved memory");
assert.match(consoleHtml, /userMemoryProposalList/, "Console Settings must show memory proposals");
assert.match(consoleHtml, /userMemoryAutoApprove/, "Console Settings must expose generated-memory auto-save opt-in");
assert.match(consoleJs, /renderGovernedMemoryList/, "Console must render governed memory");
assert.match(consoleJs, /data-memory-approve/, "Console must support proposal approval");
assert.match(consoleJs, /data-memory-reject/, "Console must support proposal rejection");
assert.match(consoleJs, /data-memory-delete/, "Console must support memory deletion");
assert.match(consoleJs, /autoApproveGenerated/i,
  "Console must expose explicit generated-memory controls");
assert.match(lifecycle, /maybeProposeTaskCompletionMemory/,
  "Task lifecycle must enqueue automatic memory proposals in service code");

assert.match(compiler, /context_packet\.background_contexts/, "ContextCompiler must select scoped memory via background contexts");
assert.match(tests, /requires proposal review before approved memory injection/,
  "tests must prove proposals are not injected before approval");
assert.match(tests, /routine task completion summaries do not enter memory proposals by default/,
  "tests must prove routine task memory does not become approval noise by default");
assert.match(tests, /review bounded task completion summaries after explicit review-mode opt-in/,
  "tests must prove generated task memory can still use proposal review after explicit opt-in");
assert.match(tests, /auto-approves only after explicit user opt-in/,
  "tests must prove generated task memory can only auto-approve behind explicit opt-in");
assert.match(tests, /can reject proposals and delete approved memory/,
  "tests must prove reject/delete governance flows");
assert.match(tests, /context compiler can select scoped reviewed memory/,
  "tests must prove scoped reviewed memory reaches ContextCompiler");

assert.match(docs, /MX-001[\s\S]{0,220}Done/, "runtime spine must mark MX-001 done");
assert.match(docs, /memory_proposal|Memory governance/,
  "docs must describe memory governance");

console.log("[verify-memory-governance] Memory governance verified");
