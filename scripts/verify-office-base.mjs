import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildOfficeContextPacket, submitOfficeTask } from "../src/service/core/office-submission.mjs";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { createSelfSignedCertPlan, explainSpikeDecision } from "../src/service/https/self-signed-cert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

for (const [host, hostName] of [
  ["word", "Document"],
  ["excel", "Workbook"],
  ["ppt", "Presentation"]
]) {
  const manifest = await readFile(path.join(repoRoot, "office_addin", host, "manifest.xml"), "utf8");
  assert.match(manifest, new RegExp(`<Host Name="${hostName}"`));
  assert.match(manifest, /http:\/\/127\.0\.0\.1:4310\/office\/task_pane\.html/);
  assert.match(manifest, /http:\/\/127\.0\.0\.1:4310\/office\/icon-32\.png/);
  assert.match(manifest, /http:\/\/127\.0\.0\.1:4310\/office\/icon-80\.png/);
  assert.match(manifest, /VersionOverridesV1_0/);
  assert.match(manifest, /PrimaryCommandSurface/);
  assert.match(manifest, /OfficeTab id="TabHome"/);
  assert.match(manifest, /ShowTaskpane/);
  assert.match(manifest, /UCA\.Button\.Label/);
}

const setupScript = await readFile(path.join(repoRoot, "scripts", "setup-office-addins.ps1"), "utf8");
assert.match(setupScript, /UCAOfficeAddins/);
assert.match(setupScript, /TrustedCatalogs/);
assert.match(setupScript, /ClearInstalledExtensions/);
assert.match(setupScript, /ResetCache/);
assert.match(setupScript, /uca-word\.xml/);
assert.match(setupScript, /uca-excel\.xml/);
assert.match(setupScript, /uca-ppt\.xml/);

const fallbackPlan = createSelfSignedCertPlan();
assert.equal(fallbackPlan.selectedPath, "path_c_protocol_fallback");
assert.equal(fallbackPlan.supportsWriteback, false);
assert.match(explainSpikeDecision(fallbackPlan), /protocol-handler fallback/i);

const service = createServiceBootstrap();
assert.equal(service.runtime.officeHttps.selectedPath, "path_c_protocol_fallback");
assert.equal(service.runtime.officeHttps.endpoints.postOfficeTask, "/office/task");

const wordCapture = {
  officeApp: "Word",
  hostProcess: "WINWORD.EXE",
  selectionText: "This is a Word paragraph for UCA.",
  documentName: "Draft.docx",
  documentPath: "C:/Docs/Draft.docx",
  selectionMetadata: {
    office_app: "Word",
    paragraph_count: 1,
    word_count: 7,
    style: "Heading1"
  }
};

const wordPacket = buildOfficeContextPacket({
  capture: wordCapture,
  traceId: "trace_word",
  contextId: "ctx_word",
  capturedAt: "2026-04-08T00:00:00.000Z"
});
assert.equal(wordPacket.source_type, "office_selection");
assert.equal(wordPacket.selection_metadata.office_app, "Word");

const wordResult = await submitOfficeTask({
  capture: wordCapture,
  userCommand: "请总结这段 Office 内容",
  runtime: service.runtime
});
assert.equal(wordResult.task.status, "success");

const excelResult = await submitOfficeTask({
  capture: {
    officeApp: "Excel",
    hostProcess: "EXCEL.EXE",
    selectionText: "Revenue table",
    documentName: "Revenue.xlsx",
    documentPath: "C:/Docs/Revenue.xlsx",
    selectionMetadata: {
      office_app: "Excel",
      sheet_name: "Sheet1",
      range: "A1:D5",
      row_count: 5,
      col_count: 4,
      has_headers: true,
      data_preview: [
        { month: "Jan", revenue: 10 },
        { month: "Feb", revenue: 12 }
      ]
    }
  },
  userCommand: "请总结这张表",
  runtime: service.runtime
});
assert.equal(excelResult.task.status, "success");

const pptResult = await submitOfficeTask({
  capture: {
    officeApp: "PowerPoint",
    hostProcess: "POWERPNT.EXE",
    selectionText: "Slide summary",
    documentName: "Pitch.pptx",
    documentPath: "C:/Docs/Pitch.pptx",
    selectionMetadata: {
      office_app: "PowerPoint",
      slide_index: 5,
      slide_count: 20,
      shape_type: "TextBox",
      selected_text: "Slide summary"
    }
  },
  userCommand: "请提炼这页演讲重点",
  runtime: service.runtime
});
assert.equal(pptResult.task.status, "success");

const oversizedExcel = await submitOfficeTask({
  capture: {
    officeApp: "Excel",
    hostProcess: "EXCEL.EXE",
    selectionText: "Huge range",
    selectionMetadata: {
      office_app: "Excel",
      sheet_name: "Big",
      range: "A1:Z500",
      row_count: 500,
      col_count: 26
    }
  },
  userCommand: "请总结这张表",
  runtime: service.runtime
});
assert.equal(oversizedExcel.task.status, "unsupported");

const bridgeSource = await readFile(path.join(repoRoot, "office_addin", "shared", "office_bridge.js"), "utf8");
const runtimeSource = await readFile(path.join(repoRoot, "office_addin", "shared", "office_runtime.js"), "utf8");
const bridgeContext = {
  window: {},
  console,
  fetch: null,
  globalThis: null
};
bridgeContext.globalThis = bridgeContext;
vm.createContext(bridgeContext);
vm.runInContext(bridgeSource.replace(/export /g, ""), bridgeContext, { filename: "office_bridge.js" });
vm.runInContext(runtimeSource.replace(/export /g, ""), bridgeContext, { filename: "office_runtime.js" });

const bridge = bridgeContext.createOfficeBridge();
const selection = await bridge.captureSelection();
const viewModel = bridgeContext.createOfficeTaskPaneViewModel(selection, bridge.getTransportPlan());
assert.equal(viewModel.hostTitle, "LingxY for Word");
assert.equal(viewModel.supportsWriteback, true);
assert.match(viewModel.transportStatus, /127\.0\.0\.1:4310/);

let writtenBack = "";
const mockWritableOffice = {
  context: {
    host: "Word",
    platform: "PC",
    document: {
      url: "C:/Docs/Writeback.docx",
      getSelectedDataAsync(_coercion, callback) {
        callback({ status: "succeeded", value: "Selected text" });
      },
      setSelectedDataAsync(value, _options, callback) {
        writtenBack = value;
        callback({ status: "succeeded" });
      }
    }
  },
  AsyncResultStatus: {
    Succeeded: "succeeded"
  },
  CoercionType: {
    Text: "text",
    Matrix: "matrix"
  },
  FileType: {
    Text: "text"
  }
};
const writableBridge = bridgeContext.createOfficeBridge({ officeApi: mockWritableOffice });
const writableSelection = await writableBridge.captureSelection({ scope: "selection" });
assert.equal(writableSelection.selectionText, "Selected text");
const writeResult = await writableBridge.writeResult("UCA edited text", { mode: "replace_selection" });
assert.equal(writeResult.ok, true);
assert.equal(writtenBack, "UCA edited text");

console.log("Office spike and base integration verification passed.");
