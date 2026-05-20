import assert from "node:assert/strict";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";
import { evaluateToolRisk } from "../src/service/capabilities/registry/risk_matrix.mjs";
import { ACTION_TOOL_SCHEMAS } from "../src/service/capabilities/schemas/index.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { formatResultsForAssistant, normalizeSearchRecency, searchWeb } from "../src/service/search/free-search.mjs";
import { submitActionToolTask } from "../src/service/core/action-tool-submission.mjs";
import { routeIntent } from "../src/service/core/router/intent-router.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { googleScopesToCapabilities } from "../src/service/capabilities/connectors/core/capability-mapper.mjs";
import { upsertConnectedAccount } from "../src/service/capabilities/connectors/core/account-registry.mjs";
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
    smtpTransport: async (message) => ({ messageId: `verify-smtp:${message.to?.join(",") ?? "unknown"}` }),
    toolContext: {
      allowedApps: ["notepad.exe"],
      allowedRoots: [path.join(repoRoot, "tests")],
      clipboardText: "clipboard sample"
    },
    ...extras
  };
}

// UCA-053 added 8 file-discovery tools; count is now 29
const EXPECTED_TOOL_COUNT = BUILTIN_ACTION_TOOLS.length;
assert.equal(Object.keys(ACTION_TOOL_SCHEMAS).length, EXPECTED_TOOL_COUNT);

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
assert.equal(registry.list().length, EXPECTED_TOOL_COUNT);
assert.equal(registry.get("translate_text")?.id, "translate_text");
assert.equal(registry.get("web_search_fetch")?.id, "web_search_fetch");
assert.equal(registry.get("write_file")?.id, "write_file");
assert.equal(registry.get("run_script")?.id, "run_script");
assert.equal(registry.get("generate_document")?.id, "generate_document");
assert.equal(registry.get("render_svg")?.id, "render_svg");
assert.equal(evaluateToolRisk(registry.get("send_email_smtp"), { to: ["a@example.com"], subject: "x", body: "y" }, {}).requires_confirmation, true);
// UCA-049: news/search intents now route to the agentic executor so the
// planner can chain web_search_fetch + summarisation. The underlying
// intent tags still surface "search" so downstream consumers can branch.
{
  const newsRoute = routeIntent("帮我理解 DeepSeek 最近的相关消息");
  assert.equal(newsRoute.executor, "agentic");
  assert.ok(newsRoute.intent_tags?.includes("search"), "news intent must tag 'search'");

  const mailRoute = routeIntent("2026年4月最新的3个邮件");
  assert.equal(mailRoute.executor, "tool_using");
  assert.ok(mailRoute.intent_tags?.includes("connector"), "mail intent must tag connector");
  assert.equal(mailRoute.intent_tags?.includes("search"), false, "mail connector intent must not be web-search tagged");

  const accountRoute = routeIntent("我的邮箱账号是多少");
  assert.equal(accountRoute.executor, "tool_using");
}
assert.equal(normalizeSearchRecency(null, "最新 AI 新闻"), "w");
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
        return `${" ".repeat(900)}<div class="results_links"><a class="result__a" href="https://example.com/latest">Latest</a><div class="result__snippet">Fresh snippet</div></div>`;
      }
    };
  }
});
assert.equal(searchResult.recency, "w");
assert.equal(new URLSearchParams(searchRequestBody).get("df"), "w");
const formattedSearch = formatResultsForAssistant(searchResult.results, {
  query: searchResult.query,
  provider: searchResult.provider,
  recency: searchResult.recency,
  maxResults: 1
});
assert.equal(formattedSearch.includes("搜索结果：最新 AI 新闻"), true);
assert.equal(formattedSearch.includes("链接：https://example.com/latest"), true);

const originalFetch = globalThis.fetch;
const badTicketmasterUrl = "https://www.ticketmaster.com/discover/arts-theater/comedy/raleigh-nc";
const goodTicketmasterUrl = "https://www.ticketmaster.com/discover/raleigh?categoryId=KZFzniwnSyZfZ7v7na&classificationId=KnvZfZ7vAe1";
const ticketmasterFetchCalls = [];
globalThis.fetch = async (url) => {
  const value = String(url);
  ticketmasterFetchCalls.push(value);
  if (value === badTicketmasterUrl) {
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }
  if (value === goodTicketmasterUrl) {
    return new Response(`
      <html>
        <head><title>Comedy Tickets in Raleigh | Ticketmaster Arts & Theatre</title></head>
        <body><main><h1>Comedy Tickets in Raleigh</h1><p>Rob Anderson</p><p>Danae Hays</p></main></body>
      </html>
    `, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("unexpected url", { status: 500, statusText: "Unexpected" });
};
try {
  const ticketmasterResult = await registry.call("fetch_url_content", {
    url: badTicketmasterUrl,
    max_chars: 1000
  }, {});
  assert.equal(ticketmasterResult.success, true);
  assert.equal(ticketmasterResult.metadata.requested_url, badTicketmasterUrl);
  assert.equal(ticketmasterResult.metadata.fallback_url, goodTicketmasterUrl);
  assert.equal(ticketmasterResult.observation.includes("原始 URL 返回 404"), true);
  assert.equal(ticketmasterResult.observation.includes("Rob Anderson"), true);
  assert.deepEqual(ticketmasterFetchCalls, [badTicketmasterUrl, goodTicketmasterUrl]);
} finally {
  globalThis.fetch = originalFetch;
}

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

let unattendedPlannerState = 0;
const unattendedRuntime = createRuntime("unattended", {
  toolPlanner() {
    if (unattendedPlannerState > 0) {
      return {
        type: "final",
        text: "File operation prepared."
      };
    }
    unattendedPlannerState += 1;
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
assert.equal(unattendedResult.task.status, "success");
assert.equal(unattendedRuntime.store.listAuditLogs().some((entry) => entry.event_subtype === "tool.call"), true);
await stat(path.join(repoRoot, "tests", "fixtures", "sample-note.md"));

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
assert.equal(screenshotResult.success, true, `take_screenshot should succeed; got: ${screenshotResult.observation}`);
assert.equal(screenshotResult.artifact_paths.length, 1);
assert.ok(screenshotResult.artifact_paths[0].endsWith(".png"), "take_screenshot should return a PNG artifact");
const screenshotInfo = await stat(screenshotResult.artifact_paths[0]);
assert.ok(screenshotInfo.size > 0, "screenshot artifact should be non-empty");

const notificationDir = path.join(notificationTestRoot, "UCA", "notifications");
const notifyResult = await registry.call("notify", { title: "Timer", body: "Time is up", notificationDir }, {});
assert.equal(notifyResult.success, true);
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
// P4-RQ E3 stage C1: topic regex (topic_hint) no longer drives
// web=required deterministically. The previous version of this test
// relied on "AI 新闻" entity firing required; now we use an explicit
// external phrase ("网上") which IS still a kept-as-regex structural
// hard signal (`explicit_external`) and routes to required via step 1
// of the resolver chain — independent of SR availability. The
// downstream behaviour the test verifies (web_search_fetch is invoked
// with the full query and a recency bucket) is unchanged.
const newsCommand = "帮我查一下网上 DeepSeek 最近的 AI 新闻动态";
const newsResult = await submitActionToolTask({
  userCommand: newsCommand,
  executionMode: "interactive",
  runtime: searchRuntime
});
assert.equal(newsResult.task.status, "success");
assert.equal(searchedArgs.query, newsCommand);
assert.equal(searchedArgs.recency, "month");

function finalSummary(result) {
  return [...(result.taskEvents ?? [])].reverse()
    .find((event) => event.event_type === "success")?.payload?.summary ?? "";
}

const connectorAccountRuntime = createRuntime("connector-account");
upsertConnectedAccount(connectorAccountRuntime, {
  provider: "google",
  providerAccountId: "real-gmail",
  email: "real.user@example.com",
  displayName: "Real User",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  capabilities: googleScopesToCapabilities(["https://www.googleapis.com/auth/gmail.readonly"])
});
const accountResult = await submitActionToolTask({
  userCommand: "我的 Gmail 邮箱账号是多少",
  executionMode: "interactive",
  runtime: connectorAccountRuntime
});
assert.equal(accountResult.task.status, "success");
assert.equal(finalSummary(accountResult).includes("real.user@example.com"), true);
assert.equal(finalSummary(accountResult).includes("example@gmail.com"), false);

let connectorWebSearchCalled = false;
let connectorEmailArgs = null;
const fakeConnectorRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS.map((tool) =>
  tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute() {
          connectorWebSearchCalled = true;
          return { success: true, observation: "Should not be called for connector mail." };
        }
      }
    : tool.id === "account_list_emails"
      ? {
          ...tool,
          async execute(args) {
            connectorEmailArgs = args;
            return {
              success: true,
              observation: "Fake connector emails",
              metadata: {
                tool_id: "account_list_emails",
                connector_status: "success",
                provider: "google",
                accountId: "acct_real",
                account: { provider: "google", email: "real.user@example.com", displayName: "Real User" },
                emails: [
                  { subject: "Actual Gmail subject", from: "sender@example.com", received: "Sun, 19 Apr 2026 10:00:00 +0000" }
                ]
              }
            };
          }
        }
      : tool
));
const connectorMailRuntime = createRuntime("connector-mail", {
  actionToolRegistry: fakeConnectorRegistry
});
const connectorMailResult = await submitActionToolTask({
  userCommand: "2026年4月最新的1个 Gmail 邮件",
  executionMode: "interactive",
  runtime: connectorMailRuntime
});
assert.equal(connectorMailResult.task.status, "success");
assert.equal(connectorWebSearchCalled, false);
assert.equal(connectorEmailArgs.provider, "google");
assert.equal(connectorEmailArgs.limit, 1);
assert.equal(finalSummary(connectorMailResult).includes("Actual Gmail subject"), true);

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

// write_file — absolute path inside configured artifact output root allowed
const configuredOutputRoot = path.join(repoRoot, ".tmp", "verify-action-tools", "configured-output");
await mkdirFs(configuredOutputRoot, { recursive: true });
const writeConfiguredRoot = await registry.call("write_file", {
  path: path.join(configuredOutputRoot, "brokered-summary.md"),
  content: "brokered output path",
  overwrite: true
}, {
  outputDir: toolSandbox,
  runtime: {
    configStore: {
      load() {
        return { output: { defaultDir: configuredOutputRoot } };
      }
    }
  }
});
assert.equal(writeConfiguredRoot.success, true, "write_file should accept absolute paths under configured output root");

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
assert.equal(genBad.success, false, "generate_document must reject kinds outside pptx/docx/xlsx/pdf/html");

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

  const genDocx = await registry.call("generate_document", {
    kind: "docx",
    outline: {
      title: "Document Renderer",
      sections: [
        { heading: "Summary", body: "DOCX renderer verification content." }
      ]
    },
    filename: "renderer-check.docx"
  }, { outputDir: toolSandbox });
  assert.equal(genDocx.success, true, `generate_document(docx) should succeed on win32; got: ${genDocx.observation}`);
  assert.ok(genDocx.artifact_paths?.[0]?.endsWith(".docx"));
  const docxHeader = await readFileFs(genDocx.artifact_paths[0]);
  assert.equal(docxHeader[0], 0x50, "docx header byte 0 should be 'P' (ZIP magic)");
  assert.equal(docxHeader[1], 0x4b, "docx header byte 1 should be 'K' (ZIP magic)");

  const genXlsx = await registry.call("generate_document", {
    kind: "xlsx",
    outline: {
      rows: [
        ["name", "score"],
        ["alpha", "91"]
      ]
    },
    filename: "renderer-check.xlsx"
  }, { outputDir: toolSandbox });
  assert.equal(genXlsx.success, true, `generate_document(xlsx) should succeed on win32; got: ${genXlsx.observation}`);
  assert.ok(genXlsx.artifact_paths?.[0]?.endsWith(".xlsx"));
  const xlsxHeader = await readFileFs(genXlsx.artifact_paths[0]);
  assert.equal(xlsxHeader[0], 0x50, "xlsx header byte 0 should be 'P' (ZIP magic)");
  assert.equal(xlsxHeader[1], 0x4b, "xlsx header byte 1 should be 'K' (ZIP magic)");

  const genPdf = await registry.call("generate_document", {
    kind: "pdf",
    outline: {
      title: "PDF Renderer",
      body: "PDF renderer verification content."
    },
    filename: "renderer-check.pdf"
  }, { outputDir: toolSandbox });
  assert.equal(genPdf.success, true, `generate_document(pdf) should produce PDF or explicit HTML fallback; got: ${genPdf.observation}`);
  assert.ok(genPdf.artifact_paths?.[0]?.endsWith(".pdf") || genPdf.metadata?.needs_pdf_conversion === true);
  if (genPdf.artifact_paths?.[0]?.endsWith(".pdf")) {
    const pdfHeader = await readFileFs(genPdf.artifact_paths[0], "utf8");
    assert.ok(pdfHeader.startsWith("%PDF"), "pdf artifact should start with PDF magic");
  }
}

console.log("Action tools and execution modes verification passed.");
