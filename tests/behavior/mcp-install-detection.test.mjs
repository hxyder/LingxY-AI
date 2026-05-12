import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectMcpInstallCandidate } from "../../src/service/capabilities/mcp/install-detection.mjs";

async function withPackage(files, fn) {
  const dir = path.join(os.tmpdir(), `linxi-mcp-detect-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(dir, relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, typeof content === "string" ? content : JSON.stringify(content), "utf8");
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("MCP install detection prefers package.json explicit mcp descriptor", async () => {
  await withPackage({
    "package.json": {
      name: "@demo/search-mcp",
      mcp: {
        id: "demo-search",
        displayName: "Demo Search",
        transport: "stdio",
        command: "node",
        args: ["server.js"]
      },
      bin: { ignored: "bin/ignored.js" }
    },
    "mcp.json": {
      id: "wrong",
      command: "wrong"
    }
  }, async (dir) => {
    const result = await detectMcpInstallCandidate({ packageDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.source, "package_json_mcp");
    assert.equal(result.detected.id, "demo-search");
    assert.equal(result.detected.sourceOfArgs, "manifest");
    assert.deepEqual(result.detected.args, ["server.js"]);
  });
});

test("MCP install detection falls back to manifest files before package bin", async () => {
  await withPackage({
    "package.json": {
      name: "demo-mcp",
      bin: "bin/ignored.js"
    },
    "mcp-manifest.json": {
      servers: [{
        id: "manifest-server",
        transport: "http",
        url: "https://mcp.example.com/sse"
      }]
    }
  }, async (dir) => {
    const result = await detectMcpInstallCandidate({ packageDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.source, "mcp_manifest");
    assert.equal(result.detected.id, "manifest-server");
    assert.equal(result.detected.url, "https://mcp.example.com/sse");
    assert.equal(result.detected.sourceOfArgs, "manifest");
  });
});

test("MCP install detection can use package bin as a reviewed fallback", async () => {
  await withPackage({
    "package.json": {
      name: "bin-only-mcp",
      displayName: "Bin Only MCP",
      bin: { "bin-only-mcp": "dist/index.js" }
    },
    "dist/index.js": "console.log('mcp');\n",
    "README.md": "Run with totally-different-command --do-not-parse"
  }, async (dir) => {
    const result = await detectMcpInstallCandidate({ packageDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.source, "package_bin");
    assert.equal(result.detected.id, "bin-only-mcp");
    assert.equal(result.detected.command, process.execPath);
    assert.equal(result.detected.args[0], path.join(dir, "dist", "index.js"));
    assert.equal(result.detected.sourceOfArgs, "bin");
  });
});

test("MCP install detection rejects invalid package json without throwing", async () => {
  await withPackage({
    "package.json": "{ not-json"
  }, async (dir) => {
    const result = await detectMcpInstallCandidate({ packageDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].field, "packageDir");
    assert.match(result.errors[0].message, /Invalid JSON in package\.json/);
  });
});

test("MCP install detection does not return missing package bin targets", async () => {
  await withPackage({
    "package.json": {
      name: "missing-bin-mcp",
      bin: "dist/missing.js"
    }
  }, async (dir) => {
    const result = await detectMcpInstallCandidate({ packageDir: dir });
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /No MCP manifest or package\.json bin entry/);
  });
});

test("MCP install detection refuses README-only executable guesses", async () => {
  await withPackage({
    "package.json": {
      name: "readme-only-mcp"
    },
    "README.md": "Use npx readme-only-mcp --server"
  }, async (dir) => {
    const result = await detectMcpInstallCandidate({ packageDir: dir });
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /README text is not used/);
  });
});
