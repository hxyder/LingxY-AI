import assert from "node:assert/strict";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeMcpInstall } from "../../src/service/ai/mcp/install-execution.mjs";

async function withInstallDir(fn) {
  const dir = path.join(os.tmpdir(), `linxi-mcp-install-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeDetectedPackage(stagePlan) {
  await mkdir(stagePlan.packageDir, { recursive: true });
  await writeFile(path.join(stagePlan.packageDir, "server.js"), "console.log('mcp');\n", "utf8");
  await writeFile(path.join(stagePlan.packageDir, "package.json"), JSON.stringify({
    name: "demo-mcp",
    mcp: {
      id: "demo-mcp",
      displayName: "Demo MCP",
      transport: "stdio",
      command: "node",
      args: ["server.js"]
    }
  }), "utf8");
}

test("MCP install execution publishes only after install and manifest validation succeed", async () => {
  await withInstallDir(async (installDir) => {
    const result = await executeMcpInstall({
      source: "demo-mcp",
      paths: { mcpInstallDir: installDir },
      now: () => 1,
      randomId: () => "abc",
      async runner(stagePlan) {
        await writeDetectedPackage(stagePlan);
        return { ok: true, stdout: "installed", stderr: "" };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.server.id, "demo-mcp");
    assert.equal(existsSync(path.join(result.packageDir, "package.json")), true);
    const entries = await readdir(installDir);
    assert.equal(entries.some((entry) => entry.includes(".staging-")), false);
  });
});

test("MCP install execution refuses existing target without deleting it", async () => {
  await withInstallDir(async (installDir) => {
    const target = path.join(installDir, "demo-mcp");
    await mkdir(target, { recursive: true });
    const result = await executeMcpInstall({
      source: "demo-mcp",
      paths: { mcpInstallDir: installDir },
      async runner() {
        throw new Error("runner must not be called");
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "mcp_install_target_exists");
    assert.equal(existsSync(target), true);
  });
});

test("MCP install execution cleans staging after a failed install process", async () => {
  await withInstallDir(async (installDir) => {
    const result = await executeMcpInstall({
      source: "demo-mcp",
      paths: { mcpInstallDir: installDir },
      now: () => 2,
      randomId: () => "failed",
      async runner(stagePlan) {
        await mkdir(stagePlan.packageDir, { recursive: true });
        return { ok: false, stdout: "", stderr: "npm failed", exitCode: 1 };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "mcp_install_failed");
    assert.match(result.stderrTail, /npm failed/);
    assert.equal(existsSync(result.stagingPath), false);
  });
});

test("MCP install execution cleans staging when manifest detection fails", async () => {
  await withInstallDir(async (installDir) => {
    const result = await executeMcpInstall({
      source: "demo-mcp",
      paths: { mcpInstallDir: installDir },
      now: () => 3,
      randomId: () => "nodetect",
      async runner(stagePlan) {
        await mkdir(stagePlan.packageDir, { recursive: true });
        await writeFile(path.join(stagePlan.packageDir, "package.json"), JSON.stringify({ name: "demo-mcp" }), "utf8");
        return { ok: true, stdout: "installed", stderr: "" };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "mcp_manifest_not_detected");
    assert.equal(existsSync(result.stagingPath), false);
  });
});

test("MCP install execution reports cleanup failures without hiding the original failure", async () => {
  await withInstallDir(async (installDir) => {
    const result = await executeMcpInstall({
      source: "demo-mcp",
      paths: { mcpInstallDir: installDir },
      now: () => 4,
      randomId: () => "cleanup",
      async runner() {
        return { ok: false, stdout: "", stderr: "timeout", timedOut: true };
      },
      async removeDir() {
        throw new Error("cleanup denied");
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "external_call_timeout");
    assert.equal(result.cleanup_failed, true);
    assert.match(result.cleanup_error, /cleanup denied/);
    assert.equal(typeof result.stagingPath, "string");
  });
});

test("MCP install execution forwards allowScripts into the staged install plan", async () => {
  await withInstallDir(async (installDir) => {
    let args = [];
    const result = await executeMcpInstall({
      source: "demo-mcp",
      allowScripts: true,
      paths: { mcpInstallDir: installDir },
      async runner(stagePlan) {
        args = stagePlan.args;
        await writeDetectedPackage(stagePlan);
        return { ok: true, stdout: "", stderr: "" };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(args.includes("--ignore-scripts"), false);
  });
});
