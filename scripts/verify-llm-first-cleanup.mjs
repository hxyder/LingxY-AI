import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const agentLoop = readFileSync(new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url), "utf8");
const plannerMode = readFileSync(new URL("../src/service/executors/tool_using/planner-mode.mjs", import.meta.url), "utf8");
const plannerFormatting = readFileSync(new URL("../src/service/executors/tool_using/planner-formatting.mjs", import.meta.url), "utf8");
const toolArgRepair = readFileSync(new URL("../src/service/executors/tool_using/tool-arg-repair.mjs", import.meta.url), "utf8");
const finalComposer = readFileSync(new URL("../src/service/executors/tool_using/final-composer.mjs", import.meta.url), "utf8");
const finalization = readFileSync(new URL("../src/service/executors/tool_using/finalization.mjs", import.meta.url), "utf8");
const resolver = readFileSync(new URL("../src/service/core/planning/executor-resolver.mjs", import.meta.url), "utf8");
const submission = readFileSync(new URL("../src/service/core/context-submission.mjs", import.meta.url), "utf8");
const triage = readFileSync(new URL("../src/service/core/intent/triage.mjs", import.meta.url), "utf8");
const taskRoutes = readFileSync(new URL("../src/service/core/http-routes/task-routes.mjs", import.meta.url), "utf8");
const semanticRouter = readFileSync(new URL("../src/service/core/intent/semantic-router.mjs", import.meta.url), "utf8");
const fastExecutor = readFileSync(new URL("../src/service/executors/fast/fast-executor.mjs", import.meta.url), "utf8");
const registry = readFileSync(new URL("../src/service/capabilities/registry/registry.mjs", import.meta.url), "utf8");
const actionTools = readFileSync(new URL("../src/service/action_tools/tools/index.mjs", import.meta.url), "utf8");
const desktopLaunchTools = readFileSync(new URL("../src/service/capabilities/tools/desktop-launch-tools.mjs", import.meta.url), "utf8");
const resourceContext = readFileSync(new URL("../src/service/executors/shared/resource-context.mjs", import.meta.url), "utf8");
const consoleRenderer = readFileSync(new URL("../src/desktop/renderer/console.js", import.meta.url), "utf8");

assert.ok(!/routing_degraded[\s\S]{0,120}webMode\s*===\s*["']optional["']/.test(resolver),
  "routing_degraded must not force web=optional tasks into tool_using");

assert.ok(!agentLoop.includes(["Could", "not", "synthesize"].join(" ")),
  "internal synthesis fallback must not be user-visible");
assert.ok(!agentLoop.includes(["Error", "budget", "exhausted", "at", "iteration"].join(" ")),
  "error-budget internals must not be used as final user text");
assert.ok(!agentLoop.includes(["REFUSAL", "PATTERNS"].join("_")) && !agentLoop.includes("isRefusalText"),
  "refusal handling must not rely on case regex patches");
assert.ok(!(/\[\?？\]/.test(agentLoop) || /Interrogative markers/.test(agentLoop)),
  "prose-trap retry must use task/tool policy, not question-shape regex");
assert.ok(/function taskRequiresToolUse/.test(plannerMode) && /shouldRetryProseTrap/.test(agentLoop),
  "prose-trap retry must be gated by tool-required task state");
assert.ok(/function composeFinalAnswer/.test(finalComposer) && /tools:\s*\[\]/.test(finalComposer),
  "tool transcripts must have a no-tools final composer path");
assert.ok(/slice\(0,\s*5000\)/.test(finalization) && /slice\(0,\s*24000\)/.test(finalization),
  "final composer must receive enough observation context to avoid raw-page head truncation");
assert.ok(!/for example|例如|Key tool schemas/.test(agentLoop),
  "tool_using prompt must not carry case examples or duplicate schema prose");
assert.ok(/formatToolDescription/.test(plannerFormatting) && /policy_group/.test(plannerFormatting) && /required_capabilities/.test(plannerFormatting),
  "tool planner must see execution metadata for each tool");
assert.ok(/plannerToolDescriptorForAdapter/.test(plannerFormatting) && /name:\s*"call_tool"/.test(plannerFormatting),
  "tool planner must expose tools through one lightweight call_tool interface");
assert.ok(!/tools\.map\(toolDescriptorForAdapter\)|function toolDescriptorForAdapter/.test(agentLoop),
  "tool_using must not send every tool schema as a separate native tool");
assert.ok(/summarizeToolParameters/.test(plannerFormatting) && /args=\$\{summarizeToolParameters/.test(plannerFormatting),
  "tool inventory must show compact argument schemas so tool choice does not depend on verbs");
assert.ok(/repairSchemaArgAliases/.test(toolArgRepair) && /repaired\.query = repaired\.q/.test(toolArgRepair),
  "planner must normalize common argument aliases before executing tools");
assert.ok(/policy_group/.test(registry) && /requires_confirmation/.test(registry),
  "registry.list() must expose tool policy/scaffold metadata");
assert.ok(/hasKnownAppAlias/.test(desktopLaunchTools) && /!hasKnownAppAlias\(appArg\)/.test(desktopLaunchTools),
  "launch_app must prefer exact known aliases before fuzzy launcher ambiguity");
assert.ok(/LAUNCH_APP_TOOL/.test(actionTools),
  "action tool index must keep launch_app reachable through the builtin aggregation surface");
assert.ok(/normalizeDecisionArguments/.test(semanticRouter) && /normalized\[field\] === "true"/.test(semanticRouter),
  "SemanticRouter must normalize provider boolean strings before schema validation");
assert.ok(/UNKNOWN_LOCATION/.test(resourceContext) && /Do NOT infer a city from timezone/.test(resourceContext),
  "location-dependent tasks must ask for location instead of guessing from ambient metadata");
assert.ok(/Local folders: Desktop=/.test(resourceContext) && /do not guess C:\\\\Users\\\\\* paths/.test(resourceContext),
  "planner resources must expose exact local folder roots instead of making the model guess Windows paths");
assert.ok(/Local context first/.test(agentLoop) && /Never infer a city from timezone/.test(agentLoop),
  "tool planner prompt must treat missing location as a clarification, not a search default");
assert.ok(/frame\.event === "text_delta"/.test(consoleRenderer) && /appendConsoleChatTextDelta/.test(consoleRenderer),
  "console chat must render streaming text_delta before inline_result");
assert.ok(!/return decision\("fast"|Short chitchat|route to fast/.test(resolver),
  "executor resolver must not divert text tasks to fast");
assert.ok(!/goal\s*===\s*["']multimodal_analyze["']\s*\|\|/.test(resolver),
  "multi_modal routing must require actual image input, not text-only image words");
assert.ok(!/tryFastPath|lane:\s*"fast_path"|fast_path/.test(triage),
  "triage must not bypass the AI agent with fast_path");
assert.ok(!/tryFastPath|fastPathTool|captureMode:\s*body\.captureMode\s*\?\?\s*"fast_path"/.test(taskRoutes),
  "HTTP task submission must not bypass the AI agent with fast_path");
assert.ok(!fastExecutor.includes(["should", "Short", "Circuit", "For", "Routing", "Degraded"].join(""))
  && !fastExecutor.includes(["routing", "degraded"].join(" "))
  && !fastExecutor.includes("路由层暂不可用"),
  "fast executor must not refuse before LLM just because routing is degraded");
assert.ok(!fastExecutor.includes(["FAST", "UNBACKED", "CLAIM", "PATTERNS"].join("_"))
  && !fastExecutor.includes("detectFastUnbackedClaim"),
  "fast executor must not use output-claim regex patches");
assert.ok(/stream:\s*typeof onTextDelta === "function"/.test(fastExecutor),
  "OpenAI-compatible fast path must stream deltas");

assert.ok(/Object\.defineProperty\(task,\s*name/.test(submission),
  "background SR/memory promises must be non-enumerable");
assert.ok(/function scheduleInternalTaskPromise/.test(submission)
  && /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?then\(work\)/.test(submission),
  "background SR patch must be scheduled off the immediate executor-start path");
assert.ok(/mergeContextPacketPatch/.test(submission),
  "parallel context patches must merge rather than overwrite");
assert.ok(/featureFlags\?\.legacyDecomposer\s*===\s*true/.test(submission)
  && !/import \{ decomposeUserCommand \}/.test(submission),
  "legacy decomposer must be opt-in only and not loaded on the normal hot path");

console.log("LLM-first cleanup verifier passed.");
