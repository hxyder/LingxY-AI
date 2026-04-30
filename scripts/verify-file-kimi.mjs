import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { submitCommand } from "../uca-cli/src/submit.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { submitContextTask } from "../src/service/core/context-submission.mjs";
import { submitFileTask } from "../src/service/core/file-submission.mjs";
import { extractFileContent } from "../src/service/extractors/file-ingest.mjs";
import { detectRequestedOutputFormat } from "../src/service/executors/kimi/output-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-file-kimi");
process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = "1";
const sampleNote = path.join(repoRoot, "tests", "fixtures", "sample-note.md");
const sampleText = path.join(repoRoot, "tests", "fixtures", "sample-text.txt");
const mockCli = path.join(repoRoot, "tests", "fixtures", "mock-kimi-cli.mjs");
const sampleCsv = path.join(runtimeDir, "sample-table.csv");
const sampleJson = path.join(runtimeDir, "sample-data.json");
const sampleDocx = path.join(runtimeDir, "sample-brief.docx");
const sampleXlsx = path.join(runtimeDir, "sample-sheet.xlsx");

assert.equal(detectRequestedOutputFormat("给我生成一份word文档，关于AI的分析发展报告，保存到桌面").id, "docx");

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
await writeFile(sampleCsv, "name,score\nalpha,91\nbeta,88\n", "utf8");
await writeFile(sampleJson, JSON.stringify({ team: "uca", status: "ready", count: 3 }, null, 2), "utf8");
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(repoRoot, "scripts", "create-ooxml-fixture.ps1"),
    "-TargetPath",
    sampleDocx,
    "-Kind",
    "docx",
    "-Text",
    "UCA DOCX verification content"
  ],
  {
    cwd: repoRoot,
    stdio: "pipe"
  }
);
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(repoRoot, "scripts", "create-ooxml-fixture.ps1"),
    "-TargetPath",
    sampleXlsx,
    "-Kind",
    "xlsx",
    "-Text",
    "UCA XLSX verification content"
  ],
  {
    cwd: repoRoot,
    stdio: "pipe"
  }
);

const csvExtract = await extractFileContent(sampleCsv);
assert.equal(csvExtract.mime, "text/csv");
assert.equal(csvExtract.extraction_mode, "native_text");
assert.equal(csvExtract.text.includes("alpha,91"), true);

const jsonExtract = await extractFileContent(sampleJson);
assert.equal(jsonExtract.mime, "application/json");
assert.equal(jsonExtract.extraction_mode, "native_text");
assert.equal(jsonExtract.text.includes("\"status\": \"ready\""), true);

const docxExtract = await extractFileContent(sampleDocx);
assert.equal(docxExtract.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
assert.equal(docxExtract.extraction_mode, "office_open_xml_text");
assert.equal(docxExtract.text.includes("UCA DOCX verification content"), true);

const xlsxExtract = await extractFileContent(sampleXlsx);
assert.equal(xlsxExtract.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
assert.equal(xlsxExtract.extraction_mode, "office_open_xml_text");
assert.equal(xlsxExtract.text.includes("UCA XLSX verification content"), true);

const runtime = {
  store: createInMemoryStoreScaffold(),
  eventBus: createEventBusScaffold(),
  queue: createTaskQueueScaffold(),
  artifactStore: createArtifactStore({ baseDir: runtimeDir }),
  kimiRuntime: {
    command: process.execPath,
    args: [mockCli],
    env: process.env,
    transport: "stream_json_print",
    maxRuntimeSeconds: 30
  }
};

const transport = {
  async submitContextAndTask(payload) {
    return submitFileTask({
      filePaths: payload.task.filePaths,
      userCommand: payload.task.userCommand,
      captureMode: payload.source.captureMode,
      sourceApp: payload.source.sourceApp,
      runtime
    });
  }
};

const result = await submitCommand(
  [
    "submit",
    "--files",
    sampleNote,
    sampleText,
    sampleCsv,
    sampleJson,
    sampleDocx,
    sampleXlsx,
    "--command",
    "分析这些文件并生成 markdown 报告文件",
    "--batch-key",
    "verify-file-kimi"
  ],
  transport
);

assert.equal(result.accepted, true);
assert.equal(result.mode, "file_group");
assert.equal(result.response.task.executor, "code_cli");
assert.equal(result.response.task.context_packet.source_type, "file_group");
assert.equal(result.response.task.context_packet.file_metadata.length, 6);
assert.equal(result.response.task.status, "success");
assert.equal(result.response.artifacts.length, 1);
assert.match(result.response.artifacts[0].path, /report\.md$/);
assert.ok(runtime.store.taskEvents.some((event) => event.event_type === "artifact_created"));

const htmlResult = await submitFileTask({
  filePaths: [sampleNote],
  userCommand: "请总结这个文件，并保存为 html 文件",
  captureMode: "shell_menu",
  sourceApp: "explorer.exe",
  runtime
});
assert.equal(htmlResult.task.status, "success");
assert.match(htmlResult.artifacts[0].path, /result\.html$/);
assert.equal((await readFile(htmlResult.artifacts[0].path, "utf8")).includes("<html"), true);

const docxResult = await submitFileTask({
  filePaths: [sampleText],
  userCommand: "请总结这个文件，并保存为 docx 文档",
  captureMode: "shell_menu",
  sourceApp: "explorer.exe",
  runtime
});
assert.equal(docxResult.task.status, "success");
assert.match(docxResult.artifacts[0].path, /result\.docx$/);
assert.match(docxResult.artifacts[1].path, /result-preview\.txt$/);

const contextRuntime = {
  store: createInMemoryStoreScaffold(),
  eventBus: createEventBusScaffold(),
  queue: createTaskQueueScaffold(),
  artifactStore: createArtifactStore({ baseDir: path.join(runtimeDir, "context-artifacts") }),
  executors: [
    {
      id: "fast",
      async *execute() {
        yield { event_type: "inline_result", payload: { text: "AI 发展分析报告\n\n核心观点：模型能力与工具生态同步扩展。" } };
        yield { event_type: "success", payload: { text: "AI 发展分析报告\n\n核心观点：模型能力与工具生态同步扩展。" } };
      }
    }
  ]
};
const contextDocxResult = await submitContextTask({
  contextPacket: { text: "AI development context" },
  userCommand: "给我生成一份word文档，关于AI的分析发展报告",
  runtime: contextRuntime
});
assert.equal(contextDocxResult.task.status, "success");
assert.ok(contextDocxResult.artifacts.some((artifact) => /result\.docx$/.test(artifact.path)));
assert.ok(contextRuntime.store.taskEvents.some((event) => event.event_type === "artifact_created"));

console.log("File entry and Kimi bridge verification passed.");
