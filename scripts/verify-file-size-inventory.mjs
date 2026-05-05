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
  "src/desktop/renderer/shared-core.css",
  "src/desktop/renderer/shared-tasks.css",
  "src/desktop/renderer/shared-chat.css",
  "src/desktop/renderer/shared-rest.css",
  "src/desktop/tray/electron-main.mjs",
  "src/service/action_tools/tools/index.mjs"
];
const hotspotGrowthBudgets = Object.freeze({
  "src/desktop/renderer/console.js": { baselineLines: 11494, maxAddedLines: 200 },
  "src/desktop/renderer/overlay.js": { baselineLines: 7255, maxAddedLines: 200 },
  "src/desktop/renderer/shared-core.css": { baselineLines: 1370, maxAddedLines: 200 },
  "src/desktop/renderer/shared-tasks.css": { baselineLines: 520, maxAddedLines: 200 },
  "src/desktop/renderer/shared-chat.css": { baselineLines: 2015, maxAddedLines: 200 },
  "src/desktop/renderer/shared-rest.css": { baselineLines: 2878, maxAddedLines: 200 },
  "src/desktop/tray/electron-main.mjs": { baselineLines: 4086, maxAddedLines: 200 },
  "src/service/action_tools/tools/index.mjs": { baselineLines: 3900, maxAddedLines: 200 }
});
const hardLineLimit = 12_500;
const sharedCssImports = [
  "./tokens.css",
  "./shared-core.css",
  "./shared-tasks.css",
  "./shared-chat.css",
  "./shared-rest.css"
];

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

for (const [hotspot, budget] of Object.entries(hotspotGrowthBudgets)) {
  assert(
    inventory.includes(`\`${hotspot}\``) && inventory.includes(`${budget.baselineLines}`),
    `file_size_inventory.md must document the line-count baseline for ${hotspot}`
  );
  const row = rows.find((candidate) => candidate.path === hotspot);
  assert(row, `hotspot budget target no longer exists: ${hotspot}`);
  const allowedLines = budget.baselineLines + budget.maxAddedLines;
  assert(
    row.lines <= allowedLines,
    `${hotspot} grew from ${budget.baselineLines} to ${row.lines} lines. Split the hotspot or update file_size_inventory.md with a deliberate new baseline before release.`
  );
}

const sharedCss = await readFile(path.join(repoRoot, "src", "desktop", "renderer", "shared.css"), "utf8");
const sharedCssLines = sharedCss.trim().split(/\r?\n/);
assert.deepEqual(
  sharedCssLines,
  sharedCssImports.map((target) => `@import url("${target}");`),
  "shared.css must remain an import-only aggregator in the original cascade order"
);

console.log("ok verify-file-size-inventory");
