import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeNativeMessage, decodeNativeMessage } from "../uca-native-host/protocol.mjs";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";
import { captureOfficeSelection, submitOfficeSelection } from "../office_addin/shared/office_bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tmpRoot = path.join(repoRoot, ".tmp", "verify-native-integrations", crypto.randomUUID());
const verifyPipeName = `\\\\.\\pipe\\uca-helper-explorer-selection-${crypto.randomUUID()}`;

async function cleanupTempDir(directory) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== "EBUSY") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function publishDotnet(projectPath, outputDir) {
  return runCommand("dotnet", [
    "publish",
    projectPath,
    "-c", "Release",
    "-o", outputDir,
    "--nologo"
  ]);
}

async function runNativeHost(hostExe, message, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(hostExe, [], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env
      }
    });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Native host exited with ${code}: ${stderr}`));
        return;
      }
      resolve(decodeNativeMessage(Buffer.concat(chunks)));
    });
    child.stdin.write(encodeNativeMessage(message));
    child.stdin.end();
  });
}

await mkdir(tmpRoot, { recursive: true });
const runtime = createPersistentRuntime({
  baseDir: path.join(tmpRoot, "runtime"),
  port: 0,
  pipeName: verifyPipeName
});

try {
  const listening = await runtime.start();

  const sampleFile = path.join(tmpRoot, "sample.txt");
  await writeFile(sampleFile, "Native integration verification content", "utf8");

  const cliResult = await runCommand("node", [
    "uca-cli/src/cli.mjs",
    "submit",
    "--files",
    sampleFile,
    "--command",
    "请总结这个文件"
  ], {
    env: {
      ...process.env,
      UCA_RUNTIME_BASE_URL: listening.baseUrl
    }
  });
  const cliPayload = JSON.parse(cliResult.stdout);
  assert.equal(cliPayload.accepted, true);
  assert.equal(Boolean(cliPayload.response.task.task_id), true);

  const helperOutDir = path.join(tmpRoot, "helper-publish");
  await publishDotnet("src/helper/explorer_selection/UcaExplorerSelectionHelper/UcaExplorerSelectionHelper.csproj", helperOutDir);
  const helperResponse = await runCommand(path.join(helperOutDir, "UcaExplorerSelectionHelper.exe"), [
    "--files",
    sampleFile,
    "--command",
    "请分析这个文件",
    "--pipe-name",
    listening.pipeName
  ]);
  const helperPayload = JSON.parse(helperResponse.stdout.trim());
  assert.equal(helperPayload.ok, true);

  const nativeHostOutDir = path.join(tmpRoot, "native-host-publish");
  await publishDotnet("uca-native-host/UcaNativeHost/UcaNativeHost.csproj", nativeHostOutDir);
  const nativeHostPing = await runNativeHost(path.join(nativeHostOutDir, "UcaNativeHost.exe"), {
    protocolVersion: "1.0",
    requestId: "req_ping",
    action: "ping"
  }, {
    UCA_RUNTIME_BASE_URL: listening.baseUrl
  });
  assert.equal(nativeHostPing.ok, true);

  const nativeHostSubmit = await runNativeHost(path.join(nativeHostOutDir, "UcaNativeHost.exe"), {
    protocolVersion: "1.0",
    requestId: "req_submit",
    action: "submit_capture",
    payload: {
      userCommand: "请总结网页选区",
      capture: {
        sourceType: "text_selection",
        browser: "chrome.exe",
        url: "https://example.com",
        pageTitle: "Example",
        text: "Selected browser text",
        selectionText: "Selected browser text"
      }
    }
  }, {
    UCA_RUNTIME_BASE_URL: listening.baseUrl
  });
  assert.equal(nativeHostSubmit.ok, true);
  assert.equal(nativeHostSubmit.payload.sourceType, "text_selection");

  const mockOffice = {
    context: {
      host: "Word",
      platform: "PC",
      document: {
        url: "C:/Docs/Native.docx",
        getSelectedDataAsync(_coercion, callback) {
          callback({
            status: "succeeded",
            value: "Office native selection"
          });
        }
      }
    },
    AsyncResultStatus: {
      Succeeded: "succeeded"
    },
    CoercionType: {
      Text: "text",
      Matrix: "matrix"
    }
  };
  const officeSelection = await captureOfficeSelection(mockOffice);
  assert.equal(officeSelection.selectionText, "Office native selection");

  const officeSubmit = await submitOfficeSelection({
    transportPlan: {
      selectedPath: "path_b_http_runtime",
      baseUrl: listening.baseUrl,
      fallbackProtocolUrl: "uca://office-submit"
    },
    userCommand: "请总结 Office 选区",
    selection: officeSelection,
    fetchImpl: fetch,
    locationImpl: null
  });
  assert.equal(officeSubmit.task.status, "success");
} finally {
  await runtime.stop();
  await cleanupTempDir(tmpRoot);
}

console.log("Native integrations verification passed.");
