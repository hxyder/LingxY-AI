import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const workflow = read(".github/workflows/release-artifacts.yml");
const repoBaseline = read(".github/workflows/repo-baseline.yml");
const releaseGate = read(".github/workflows/release-gate.yml");
const packageJson = JSON.parse(read("package.json"));
const releaseChecklist = read("docs/release/github_release_checklist.md");
const readme = read("README.md");

assert.match(workflow, /name:\s+Release Artifacts/, "release artifact workflow must be named");
assert.match(workflow, /runs-on:\s+windows-latest/, "release artifacts must build on Windows");
assert.match(workflow, /node-version:\s+"22\.12\.0"/, "release artifacts must pin Node 22.12.0");
assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s+"false"/, "unsigned CI builds must not auto-discover signing identities");
assert.match(workflow, /npm ci/, "release workflow must install from lockfile");
assert.match(workflow, /npm run check/, "release workflow must run full check before packaging");
assert.match(workflow, /npm run licenses/, "release workflow must refresh third-party notices before packaging");
assert.match(workflow, /npm run dist/, "release workflow must build installer artifacts");
assert.match(workflow, /THIRD_PARTY_LICENSES\.md/, "release workflow must ship third-party notices");
assert.match(workflow, /Get-FileHash\s+-Algorithm\s+SHA256/, "release workflow must generate SHA256 checksums");
assert.match(workflow, /actions\/upload-artifact@v4/, "release workflow must upload build artifacts");
assert.match(workflow, /gh release create/, "release workflow must support draft GitHub Release creation");
assert.match(workflow, /gh release upload/, "release workflow must support updating an existing release");

assert.match(repoBaseline, /node-version:\s+"22\.12\.0"/, "repo baseline must use the documented Node baseline");
assert.match(releaseGate, /node-version:\s+"22\.12\.0"/, "release gate must use the documented Node baseline");

assert.equal(packageJson.scripts["verify:release-artifact-workflow"], "node scripts/verify-release-artifact-workflow.mjs");
assert.match(packageJson.scripts.check, /verify-release-artifact-workflow\.mjs/, "npm run check must include release artifact workflow verification");

assert.match(releaseChecklist, /Release Artifacts/, "release checklist must mention the release artifact workflow");
assert.match(releaseChecklist, /checksums\.sha256/, "release checklist must require checksum review");
assert.match(releaseChecklist, /THIRD_PARTY_LICENSES\.md/, "release checklist must require third-party notice artifacts");
assert.match(readme, /Release Artifacts/, "README must document the release artifact workflow");

console.log("Release artifact workflow verification passed.");
