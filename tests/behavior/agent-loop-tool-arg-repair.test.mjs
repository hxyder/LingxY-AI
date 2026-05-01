import test from "node:test";
import assert from "node:assert/strict";

import {
  repairSchemaArgAliases,
  repairToolArgs
} from "../../src/service/executors/tool_using/tool-arg-repair.mjs";

test("agent tool arg repair normalizes schema aliases without changing valid args", () => {
  assert.deepEqual(
    repairSchemaArgAliases({ q: "climate news" }, { parameters: { properties: { query: { type: "string" } } } }),
    { query: "climate news" }
  );

  assert.deepEqual(
    repairSchemaArgAliases({ path: "E:/linxi/report.docx" }, { parameters: { properties: { localPath: { type: "string" } } } }),
    { localPath: "E:/linxi/report.docx" }
  );

  assert.deepEqual(
    repairSchemaArgAliases({ query: "already good", limit: 3 }, { parameters: { properties: { query: {}, limit: {} } } }),
    { query: "already good", limit: 3 }
  );
});

test("agent tool arg repair preserves explicit launch app aliases", () => {
  const repaired = repairToolArgs(
    { tool: "launch_app", args: { name: ["Excel", "Word"], appName: "ignored" } },
    { user_command: "打开 YouTube，打开 Excel，打开 Word" },
    []
  );

  assert.deepEqual(repaired, { app: "Excel" });
});

test("agent tool arg repair fills the next unattempted compound launch target", () => {
  const transcript = [
    { type: "tool_result", tool: "launch_app", args: { app: "YouTube" }, success: false },
    { type: "tool_result", tool: "launch_app", args: { app: "Excel.exe" }, success: true }
  ];

  const repaired = repairToolArgs(
    { tool: "launch_app", args: {} },
    { user_command: "打开 YouTube，打开 Excel，打开 Word" },
    transcript
  );

  assert.deepEqual(repaired, { app: "Word" });
});
