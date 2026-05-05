import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const scanRoots = ["src", "browser_ext", "scripts", "tests"];
const sourceExtensions = new Set([".js", ".mjs", ".css", ".html"]);
const documentedHotspots = [
  "src/desktop/renderer/console.js",
  "src/desktop/renderer/overlay.js",
  "src/desktop/renderer/shared.css",
  "src/desktop/tray/electron-main.mjs",
  "src/service/action_tools/tools/index.mjs"
];
const hardLineLimit = 12_500;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      yield* walk(fullPath);
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

async function countLines(filePath) {
  const text = await readFile(filePath, "utf8");
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

const rows = [];
for (const root of scanRoots) {
  const rootPath = path.join(repoRoot, root);
  try {
    await stat(rootPath);
  } catch {
    continue;
  }
  for await (const filePath of walk(rootPath)) {
    rows.push({ path: toRepoPath(filePath), lines: await countLines(filePath) });
  }
}

rows.sort((a, b) => b.lines - a.lines);
const oversized = rows.filter((row) => row.lines > hardLineLimit);
assert.deepEqual(
  oversized,
  [],
  `Files over ${hardLineLimit} lines need a split before release: ${oversized.map((row) => `${row.path}:${row.lines}`).join(", ")}`
);

const inventory = await readFile(path.join(repoRoot, "docs", "release", "file_size_inventory.md"), "utf8");
for (const hotspot of documentedHotspots) {
  assert(
    inventory.includes(`\`${hotspot}\``),
    `file_size_inventory.md must document ${hotspot}`
  );
}

for (const hotspot of documentedHotspots) {
  assert(
    rows.some((row) => row.path === hotspot),
    `documented hotspot no longer exists: ${hotspot}`
  );
}

console.log("ok verify-file-size-inventory");
