import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const consoleHtml = await read("src/desktop/renderer/console.html");
assert.equal(consoleHtml.includes("任务与详情"), true);
assert.equal(consoleHtml.includes("审批中心"), true);
assert.equal(consoleHtml.includes("计划任务"), true);
assert.equal(consoleHtml.includes("模板工作区"), true);
assert.equal(consoleHtml.includes("预算与配额"), true);
assert.equal(consoleHtml.includes("历史搜索"), true);

const consoleJs = await read("src/desktop/renderer/console.js");
assert.equal(consoleJs.includes('fetchJson("/approvals")'), true);
assert.equal(consoleJs.includes('fetchJson("/schedules")'), true);
assert.equal(consoleJs.includes('fetchJson("/templates")'), true);
assert.equal(consoleJs.includes('fetchJson("/budget")'), true);
assert.equal(consoleJs.includes('fetchJson("/history/search"'), true);
assert.equal(consoleJs.includes('window.ucaShell.showWindow("overlay")'), true);

console.log("Rendered console workspace verification passed.");
