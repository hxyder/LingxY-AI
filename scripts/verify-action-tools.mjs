import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { evaluateToolRisk } from "../src/service/action_tools/risk_matrix.mjs";
import { ACTION_TOOL_SCHEMAS } from "../src/service/action_tools/schemas/index.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { formatResultsForAssistant, normalizeSearchRecency, searchWeb } from "../src/service/search/free-search.mjs";
import { submitActionToolTask } from "../src/service/core/action-tool-submission.mjs";
import { routeIntent } from "../src/service/core/router/intent-router.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { buildToolCallConfirmViewModel } from "../src/desktop/console/tool-call-confirm/view-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const notificationTestRoot = path.join(repoRoot, ".tmp", "verify-action-tools", "appdata");
process.env.APPDATA = notificationTestRoot;

function createRuntime(name, extras = {}) {
  return {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-action-tools", name) }),
    actionToolRegistry: createActionToolRegistry(BUILTIN_ACTION_TOOLS),
    toolContext: {
      allowedApps: ["notepad.exe"],
      allowedRoots: [path.join(repoRoot, "tests")],
      clipboardText: "clipboard sample"
    },
    ...extras
  };
}

assert.equal(BUILTIN_ACTION_TOOLS.length, 21);
assert.equal(Object.keys(ACTION_TOOL_SCHEMAS).length, 21);

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
assert.equal(registry.list().length, 21);
assert.equal(registry.get("translate_text")?.id, "translate_text");
assert.equal(registry.get("web_search_fetch")?.id, "web_search_fetch");
assert.equal(registry.get("write_file")?.id, "write_file");
assert.equal(registry.get("run_script")?.id, "run_script");
assert.equal(registry.get("generate_document")?.id, "generate_document");
assert.equal(evaluateToolRisk(registry.get("send_email_smtp"), { to: ["a@example.com"], subject: "x", body: "y" }, {}).requires_confirmation, true);
// UCA-049: news/search intents now route to the agentic executor so the
// planner can chain web_search_fetch + summarisation. The underlying
// intent tags still surface "search" so downstream consumers can branch.
{
  const newsRoute = routeIntent("帮我理解 DeepSeek 最近的相关消息");
  assert.equal(newsRoute.executor, "agentic");
  assert.ok(newsRoute.intent_tags?.includes("search"), "news intent must tag 'search'");
}
assert.equal(normalizeSearchRecency(null, "最新 AI 新闻"), "m");
assert.equal(normalizeSearchRecency("day", "AI news"), "d");

let searchRequestBody = "";
const searchResult = await searchWeb({
  query: "最新 AI 新闻",
  limit: 1,
  fetchImpl: async (_url, options) => {
    searchRequestBody = options.body;
    return {
      ok: true,
      async text() {
        return '<div class="result"><a class="result__a" href="https://example.com/latest">Latest</a><a class="result__snippet">Fresh snippet</a></div>';
      }
    };
  }
});
assert.equal(searchResult.recency, "m");
assert.equal(new URLSearchParams(searchRequestBody).get("df"), "m");
const formattedSearch = formatResultsForAssistant(searchResult.results, {
  query: searchResult.query,
  provider: searchResult.provider,
  recency: searchResult.recency,
  maxResults: 1
});
assert.equal(formattedSearch.includes("搜索结果：最新 AI 新闻"), true);
assert.equal(formattedSearch.includes("链接：https://example.com/latest"), true);

let interactivePlannerState = 0;
const interactiveRuntime = createRuntime("interactive", {
  toolPlanner() {
    if (interactivePlannerState === 0) {
      interactivePlannerState += 1;
      return {
        type: "tool_call",
        tool: "send_email_smtp",
        args: {
          to: ["advisor@example.com"],
          subject: "Draft",
          body: "First pass"
        }
      };
    }
    return {
      type: "final",
      text: "Interactive tool flow completed."
    };
  },
  confirmationHandler() {
    return {
      decision: "edit",
      args: {
        to: ["advisor@example.com"],
        subject: "Edited Draft",
        body: "Edited body"
      }
    };
  }
});

const interactiveResult = await submitActionToolTask({
  userCommand: "请发送邮件给导师",
  executionMode: "interactive",
  runtime: interactiveRuntime
});
assert.equal(interactiveResult.task.status, "success");
assert.equal(interactiveRuntime.store.listAuditLogs().some((entry) => entry.event_subtype === "tool.call"), true);

const unattendedRuntime = createRuntime("unattended", {
  toolPlanner() {
    return {
      type: "tool_call",
      tool: "file_op",
      args: {
        operation: "delete",
        path: path.join(repoRoot, "tests", "fixtures", "sample-note.md")
      }
    };
  }
});
const unattendedResult = await submitActionToolTask({
  userCommand: "删除这个文件",
  executionMode: "unattended_safe",
  runtime: unattendedRuntime
});
assert.equal(unattendedResult.task.status, "partial_success");
assert.equal(unattendedRuntime.store.listAuditLogs().some((entry) => entry.event_subtype === "tool.denied"), true);

const approvalRuntime = createRuntime("approval", {
  toolPlanner() {
    return {
      type: "tool_call",
      tool: "send_email_smtp",
      args: {
        to: ["ops@example.com"],
        subject: "Queued approval",
        body: "Pending send"
      }
    };
  }
});
const approvalResult = await submitActionToolTask({
  userCommand: "定时发送邮件",
  executionMode: "approval_required",
  runtime: approvalRuntime
});
assert.equal(approvalResult.task.sub_status, "waiting_external_decision");
assert.equal(approvalRuntime.store.listPendingApprovals().length, 1);

const screenshotResult = await registry.call("take_screenshot", { label: "capture-1" }, {
  outputDir: path.join(repoRoot, ".tmp", "verify-action-tools", "artifacts")
});
assert.equal(screenshotResult.artifact_paths.length, 1);

const notifyResult = await registry.call("notify", { title: "Timer", body: "Time is up" }, {});
assert.equal(notifyResult.success, true);
const notificationDir = path.join(notificationTestRoot, "UCA", "notifications");
const notificationFiles = await readdir(notificationDir);
assert.equal(notificationFiles.length >= 1, true);
const notificationPayload = JSON.parse(await readFile(path.join(notificationDir, notificationFiles[0]), "utf8"));
assert.equal(notificationPayload.title, "Timer");
await rm(notificationTestRoot, { recursive: true, force: true });

const confirmVm = buildToolCallConfirmViewModel({
  toolId: "send_email_smtp",
  args: { to: ["ops@example.com"] },
  risk: {
    risk_level: "high",
    requires_confirmation: true
  },
  mode: "interactive"
});
assert.equal(confirmVm.actions.includes("deny"), true);

let launchedApp = null;
let openedUrl = null;
const fakeLaunchRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS.map((tool) =>
  tool.id === "launch_app"
    ? {
        ...tool,
        async execute(args) {
          launchedApp = args.app;
          return { success: true, observation: `Fake launched ${args.app}` };
        }
      }
    : tool.id === "open_url"
      ? {
          ...tool,
          async execute(args) {
            openedUrl = args.url;
            return { success: true, observation: `Fake opened ${args.url}` };
          }
        }
    : tool
));
const launchRuntime = createRuntime("launch", {
  actionToolRegistry: fakeLaunchRegistry,
  toolContext: {
    allowedApps: ["notepad"],
    allowedRoots: [path.join(repoRoot, "tests")],
    clipboardText: "clipboard sample"
  }
});
const launchResult = await submitActionToolTask({
  userCommand: "启动 notepad",
  executionMode: "interactive",
  runtime: launchRuntime
});
assert.equal(launchResult.task.status, "success");
assert.equal(launchedApp, "notepad");
assert.equal(openedUrl, null);

const openUrlResult = await submitActionToolTask({
  userCommand: "打开 https://example.com",
  executionMode: "interactive",
  runtime: launchRuntime
});
assert.equal(openUrlResult.task.status, "success");
assert.equal(openedUrl, "https://example.com");

let searchedArgs = null;
const fakeSearchRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS.map((tool) =>
  tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute(args) {
          searchedArgs = args;
          return { success: true, observation: "Fake current search results" };
        }
      }
    : tool
));
const searchRuntime = createRuntime("news-search", {
  actionToolRegistry: fakeSearchRegistry
});
const newsResult = await submitActionToolTask({
  userCommand: "帮我理解 DeepSeek 最近的相关消息",
  executionMode: "interactive",
  runtime: searchRuntime
});
assert.equal(newsResult.task.status, "success");
assert.equal(searchedArgs.query, "帮我理解 DeepSeek 最近的相关消息");
assert.equal(searchedArgs.recency, "month");

/* ------------------------------------------------------------------------ */
/* UCA-049 commit 2: universal tool belt                                     */
/* ------------------------------------------------------------------------ */

const toolSandbox = path.join(repoRoot, ".tmp", "verify-action-tools", "tool-belt");
await rm(toolSandbox, { recursive: true, force: true });
const { mkdir: mkdirFs } = await import("node:fs/promises");
await mkdirFs(toolSandbox, { recursive: true });

// write_file — happy path
const writeOk = await registry.call("write_file", {
  path: "notes/readme.txt",
  content: "UCA test write"
}, { outputDir: toolSandbox });
assert.equal(writeOk.success, true, "write_file should succeed inside task workspace");
assert.ok(writeOk.artifact_paths?.[0], "write_file should return an artifact path");

// write_file — reject ..
const writeTraverse = await registry.call("write_file", {
  path: "../escape.txt",
  content: "nope"
}, { outputDir: toolSandbox });
assert.equal(writeTraverse.success, false, "write_file must reject '..' segments");
assert.match(writeTraverse.observation, /\.\./);

// write_file — reject overwrite-without-flag
const writeDup = await registry.call("write_file", {
  path: "notes/readme.txt",
  content: "should not overwrite"
}, { outputDir: toolSandbox });
assert.equal(writeDup.success, false, "write_file must refuse to clobber existing files without overwrite:true");

// write_file — explicit overwrite allowed
const writeOverwrite = await registry.call("write_file", {
  path: "notes/readme.txt",
  content: "second version",
  overwrite: true
}, { outputDir: toolSandbox });
assert.equal(writeOverwrite.success, true);

// run_script — language whitelist enforcement
const runBadLang = await registry.call("run_script", {
  language: "ruby",
  script: "puts 'x'"
}, { outputDir: toolSandbox });
assert.equal(runBadLang.success, false, "run_script must reject languages outside powershell/node/python");
assert.match(runBadLang.observation, /powershell\/node\/python/);

// run_script — node happy path (we know node is available: this is a node script)
const runNode = await registry.call("run_script", {
  language: "node",
  script: "console.log('hello from run_script');",
  timeout: 5
}, { outputDir: toolSandbox });
assert.equal(runNode.success, true, `run_script(node) should succeed; got observation: ${runNode.observation}`);
assert.match(runNode.observation, /hello from run_script/);

// generate_document — reject unsupported kind
const genBad = await registry.call("generate_document", {
  kind: "epub",
  outline: { title: "x" }
}, { outputDir: toolSandbox });
assert.equal(genBad.success, false, "generate_document must reject kinds outside pptx/docx/xlsx/pdf");

// Skip real PowerShell-based ooxml generation on non-Windows so the test
// runs in CI across platforms; on Windows we actually produce a .pptx.
if (process.platform === "win32") {
  const genPptx = await registry.call("generate_document", {
    kind: "pptx",
    outline: {
      title: "Quarterly Review",
      slides: [
        { heading: "Growth", bullets: ["Revenue +12%", "Users +8%"] },
        { heading: "Risks", bullets: ["Churn steady"] }
      ]
    }
  }, { outputDir: toolSandbox });
  assert.equal(genPptx.success, true, `generate_document(pptx) should succeed on win32; got: ${genPptx.observation}`);
  assert.ok(genPptx.artifact_paths?.[0]?.endsWith(".pptx"));
  const { readFile: readFileFs } = await import("node:fs/promises");
  const header = await readFileFs(genPptx.artifact_paths[0]);
  // A valid .pptx is a ZIP archive → first two bytes are "PK".
  assert.equal(header[0], 0x50, "pptx header byte 0 should be 'P' (ZIP magic)");
  assert.equal(header[1], 0x4b, "pptx header byte 1 should be 'K' (ZIP magic)");
}

console.log("Action tools and execution modes verification passed.");
