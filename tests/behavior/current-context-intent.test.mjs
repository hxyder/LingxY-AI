import assert from "node:assert/strict";
import test from "node:test";
import {
  commandTargetsCurrentBrowserContext,
  commandTargetsCurrentFileContext
} from "../../src/shared/current-context-intent.mjs";

test("current context intent detects structural page references", () => {
  assert.equal(commandTargetsCurrentBrowserContext("请分析此页面"), true);
  assert.equal(commandTargetsCurrentBrowserContext("请分析此页"), true);
  assert.equal(commandTargetsCurrentBrowserContext("summarize this tab"), true);
  assert.equal(commandTargetsCurrentBrowserContext("分析天气新闻"), false);
});

test("current context intent detects structural file references", () => {
  assert.equal(commandTargetsCurrentFileContext("总结这份文档"), true);
  assert.equal(commandTargetsCurrentFileContext("summarize current file"), true);
  assert.equal(commandTargetsCurrentFileContext("总结今天新闻"), false);
});
