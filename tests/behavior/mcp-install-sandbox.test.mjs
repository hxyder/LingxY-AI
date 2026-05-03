import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  classifyMcpInstallSource,
  createMcpInstallSandboxPlan
} from "../../src/service/ai/mcp/install-sandbox.mjs";

const installDir = path.join(process.cwd(), ".tmp", "mcp-install-sandbox");

test("MCP install sandbox plans scoped npm packages inside the sandbox", () => {
  const plan = createMcpInstallSandboxPlan({
    source: "@modelcontextprotocol/server-filesystem",
    paths: { mcpInstallDir: installDir }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceType, "npm");
  assert.equal(plan.id, "modelcontextprotocol-server-filesystem");
  assert.equal(plan.installRoot, path.join(installDir, "modelcontextprotocol-server-filesystem"));
  assert.equal(plan.packageDir, path.join(plan.installRoot, "node_modules", "@modelcontextprotocol", "server-filesystem"));
  assert.equal(plan.args.includes("--ignore-scripts"), true);
  assert.equal(plan.cleanupOnFailure, true);
});

test("MCP install sandbox emits a spawn-compatible npm command on Windows", () => {
  const plan = createMcpInstallSandboxPlan({
    source: "demo-mcp",
    paths: { mcpInstallDir: installDir }
  });
  assert.equal(plan.ok, true);
  if (process.platform === "win32") {
    assert.equal(plan.command, "cmd.exe");
    assert.deepEqual(plan.args.slice(0, 4), ["/d", "/s", "/c", "npm.cmd"]);
  } else {
    assert.equal(plan.command, "npm");
  }
  assert.equal(plan.args.includes("install"), true);
  assert.equal(plan.args.includes("demo-mcp"), true);
});

test("MCP install sandbox can derive a deterministic GitHub install id", () => {
  const plan = createMcpInstallSandboxPlan({
    source: "https://github.com/example/my-mcp-server.git",
    paths: { mcpInstallDir: installDir }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceType, "github");
  assert.equal(plan.id, "example-my-mcp-server");
  assert.equal(plan.packageDir.endsWith(path.join("node_modules", "my-mcp-server")), true);
});

test("MCP install sandbox keeps requested ids inside the sandbox", () => {
  const plan = createMcpInstallSandboxPlan({
    source: "demo-mcp",
    id: "../outside",
    paths: { mcpInstallDir: installDir }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.id, "outside");
  assert.equal(plan.installRoot.startsWith(installDir), true);
});

test("MCP install sandbox rejects non-package install sources", () => {
  const classified = classifyMcpInstallSource("powershell -c calc.exe");
  assert.equal(classified.ok, false);
  const plan = createMcpInstallSandboxPlan({
    source: "powershell -c calc.exe",
    paths: { mcpInstallDir: installDir }
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.errors[0].field, "source");
});

test("MCP install sandbox requires a configured install directory", () => {
  const plan = createMcpInstallSandboxPlan({
    source: "demo-mcp",
    paths: {}
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.errors[0].field, "mcpInstallDir");
});
