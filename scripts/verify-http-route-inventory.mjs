import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/http-route-ownership-inventory.md");
const serverPath = path.join(root, "src/service/core/http-server.mjs");
const routesDir = path.join(root, "src/service/core/http-routes");

const expectedOrder = [
  "office-routes.mjs",
  "note-project-conversation-routes.mjs",
  "config-provider-routes.mjs",
  "mcp-install-routes.mjs",
  "ai-status-routes.mjs",
  "audio-routes.mjs",
  "preview-file-routes.mjs",
  "browser-context-routes.mjs",
  "scheduler-template-routes.mjs",
  "task-routes.mjs",
  "translation-routes.mjs",
  "runtime-admin-routes.mjs",
  "connector-routes.mjs",
  "search-routes.mjs"
];

const expectedSummary = {
  "ai-status-routes.mjs": { methods: ["GET", "PATCH"], literalCount: 7, regexCount: 2 },
  "audio-routes.mjs": { methods: ["GET", "POST"], literalCount: 9, regexCount: 0 },
  "browser-context-routes.mjs": { methods: ["DELETE", "GET", "POST"], literalCount: 6, regexCount: 0 },
  "config-provider-routes.mjs": { methods: ["DELETE", "GET", "PATCH", "POST"], literalCount: 39, regexCount: 5 },
  "connector-routes.mjs": { methods: ["DELETE", "GET", "PATCH", "POST"], literalCount: 8, regexCount: 15 },
  "mcp-install-routes.mjs": { methods: ["POST"], literalCount: 3, regexCount: 0 },
  "note-project-conversation-routes.mjs": { methods: ["DELETE", "GET", "PATCH", "POST"], literalCount: 8, regexCount: 10 },
  "office-routes.mjs": { methods: ["GET", "POST"], literalCount: 3, regexCount: 0 },
  "preview-file-routes.mjs": { methods: ["GET", "POST"], literalCount: 5, regexCount: 0 },
  "runtime-admin-routes.mjs": { methods: ["DELETE", "GET", "POST"], literalCount: 10, regexCount: 3 },
  "scheduler-template-routes.mjs": { methods: ["DELETE", "GET", "PATCH", "POST"], literalCount: 6, regexCount: 6 },
  "search-routes.mjs": { methods: ["POST"], literalCount: 1, regexCount: 0 },
  "task-routes.mjs": { methods: ["DELETE", "GET", "POST"], literalCount: 6, regexCount: 7 },
  "translation-routes.mjs": { methods: ["POST"], literalCount: 1, regexCount: 0 }
};

function fail(message) {
  console.error(`[http-route-inventory] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseRouteModule(file) {
  const text = readFileSync(path.join(routesDir, file), "utf8");
  const methods = new Set();
  const literals = new Set();
  const regexes = new Set();

  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(/method\s*(?:===|!==)\s*["']([A-Z]+)["']/g)) methods.add(match[1]);
    for (const match of line.matchAll(/(?:url\.)?pathname\s*(?:===|!==)\s*["']([^"']+)["']/g)) literals.add(match[1]);
    for (const match of line.matchAll(/(?:url\.)?pathname\.startsWith\(\s*["']([^"']+)["']/g)) literals.add(match[1]);
    for (const match of line.matchAll(/(?:url\.)?pathname\.match\((\/\^[^\n]+?\/[a-z]*)\)/g)) regexes.add(match[1]);
    for (const match of line.matchAll(/(\/\^[^\n]+?\/[a-z]*)\.test\((?:url\.)?pathname\)/g)) regexes.add(match[1]);
  }

  return {
    methods: [...methods].sort(),
    literalCount: literals.size,
    regexCount: regexes.size
  };
}

function routeOrderFromServer() {
  const text = readFileSync(serverPath, "utf8");
  const importByHandler = new Map();
  for (const match of text.matchAll(/import\s+\{\s*(tryHandle\w+Route)\s*\}\s+from\s+"\.\/http-routes\/([^"]+)";/g)) {
    importByHandler.set(match[1], match[2]);
  }
  const order = [];
  for (const match of text.matchAll(/\bhandle:\s*(?:\([^)]*\)\s*=>\s*)?(tryHandle\w+Route)\b/g)) {
    const file = importByHandler.get(match[1]);
    if (file) order.push(file);
  }
  return order;
}

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("Route Groups"), "HTTP route inventory missing route group section");
assert(doc.includes("Snapshot By Module"), "HTTP route inventory missing snapshot section");

const routeFiles = readdirSync(routesDir).filter((file) => file.endsWith(".mjs")).sort();
assert(JSON.stringify(routeFiles) === JSON.stringify([...expectedOrder].sort()), "route module set changed");
assert(JSON.stringify(routeOrderFromServer()) === JSON.stringify(expectedOrder), "HTTP dispatcher route order changed");

for (const [file, expected] of Object.entries(expectedSummary)) {
  const actual = parseRouteModule(file);
  assert(JSON.stringify(actual.methods) === JSON.stringify(expected.methods), `${file} method set changed`);
  assert(actual.literalCount === expected.literalCount, `${file} literal route count changed`);
  assert(actual.regexCount === expected.regexCount, `${file} regex route count changed`);
  assert(doc.includes(file), `HTTP route inventory missing ${file}`);
}

if (!process.exitCode) {
  console.log("[http-route-inventory] HTTP route ownership snapshot verified.");
}
