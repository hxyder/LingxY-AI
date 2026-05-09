import fs from "node:fs";
import assert from "node:assert/strict";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const lane = read("src/service/core/artifact-extracts/artifact-extract-background-lane.mjs");
const worker = read("src/service/workers/artifact-extract-worker.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read("tests/behavior/artifact-extract-background-lane.test.mjs");
const performance = read("docs/architecture/electron-js-runtime-performance-plan.md");
const spine = read("docs/architecture/agent-runtime-spine.md");
const packageJson = read("package.json");

assert.match(lane, /createArtifactExtractBackgroundLane/,
  "background lane factory must exist");
assert.match(lane, /enqueueArtifactExtract/,
  "background lane must expose enqueueArtifactExtract");
assert.match(lane, /AbortController|AbortSignal|signal/,
  "background lane must support AbortSignal");
assert.match(lane, /setTimeout/,
  "background lane must enforce timeout");
assert.match(lane, /onProgress/,
  "background lane must emit progress events");
assert.match(lane, /appendExtract/,
  "background lane must write ArtifactExtract rows through the service");
assert.match(lane, /parse_status/,
  "background lane must write structured parse quality");
assert.match(worker, /runArtifactExtractWorker/,
  "worker module must expose runArtifactExtractWorker");
assert.match(worker, /SUPPORTED_ARTIFACT_KINDS/,
  "worker must declare supported artifact families");
assert.match(worker, /xlsx[\s\S]*pptx[\s\S]*docx[\s\S]*pdf[\s\S]*html|html[\s\S]*pdf[\s\S]*docx[\s\S]*pptx[\s\S]*xlsx/,
  "worker must account for xlsx/pptx/docx/pdf/html families");
assert.match(runtimeServices, /createArtifactExtractBackgroundLane/,
  "runtime services must wire the background lane");
assert.match(runtimeServices, /artifactExtractBackgroundLane/,
  "runtime must expose artifactExtractBackgroundLane");
assert.match(tests, /records worker result and progress/,
  "tests must cover successful background extraction");
assert.match(tests, /structured failed extract/,
  "tests must cover parse failure quality");
assert.match(tests, /enforces timeout/,
  "tests must cover timeout/AbortSignal behavior");
assert.match(performance, /PR-06[\s\S]{0,220}Done/,
  "performance plan must mark PR-06 done");
assert.match(spine, /ArtifactExtract background lane|artifactExtractBackgroundLane/,
  "runtime spine must mention the artifact extract background lane");
assert.match(packageJson, /verify:artifact-extract-background-lane/,
  "package.json must expose the background lane verifier");

for (const [name, source] of [
  ["lane", lane],
  ["worker", worker]
]) {
  assert.doesNotMatch(source, /from\s+["'][^"']*electron/,
    `${name} must not import Electron main process APIs`);
  assert.doesNotMatch(source, /from\s+["'][^"']*desktop\/renderer/,
    `${name} must not import renderer code`);
  assert.doesNotMatch(source, /readFileSync|writeFileSync|readdirSync|execSync|spawnSync|Atomics\.wait/,
    `${name} must not use blocking extraction primitives`);
}

console.log("[verify-artifact-extract-background-lane] artifact extract background lane verified");
