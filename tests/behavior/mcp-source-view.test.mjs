import assert from "node:assert/strict";
import test from "node:test";
import {
  getMcpSourceView,
  isReadOnlyMcpServer
} from "../../src/desktop/renderer/mcp-source-view.mjs";

test("runtime-config MCP servers remain user-toggleable", () => {
  const view = getMcpSourceView({ id: "custom", source: "runtime_config" });
  assert.equal(view.readOnly, false);
  assert.equal(view.canToggle, true);
  assert.equal(isReadOnlyMcpServer({ source: "runtime_config" }), false);
});

test("builtin MCP servers remain user-toggleable", () => {
  for (const source of ["builtin", "builtin_mit", "lingxy_internal", undefined]) {
    const view = getMcpSourceView({ id: "builtin", source });
    assert.equal(view.readOnly, false);
    assert.equal(view.canToggle, true);
  }
});

test("JSON-declared MCP servers render as read-only", () => {
  const view = getMcpSourceView({
    id: "readonly",
    source: "E:\\linxi\\data\\integrations\\mcp\\readonly.json"
  });
  assert.equal(view.readOnly, true);
  assert.equal(view.canToggle, false);
  assert.equal(view.label, "From file");
  assert.equal(isReadOnlyMcpServer({ source: "/home/me/mcp/server.json" }), true);
});
