import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMANDS } from "./check-manifest.mjs";

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
assert.match(workflow, /npm run verify:audit-high/, "release workflow must block high/critical npm advisories");
assert.match(workflow, /npm run licenses/, "release workflow must refresh third-party notices before packaging");
assert.match(workflow, /npm run dist/, "release workflow must build installer artifacts");
assert.match(workflow, /THIRD_PARTY_LICENSES\.md/, "release workflow must ship third-party notices");
assert.match(workflow, /Get-FileHash\s+-Algorithm\s+SHA256/, "release workflow must generate SHA256 checksums");
assert.match(workflow, /actions\/upload-artifact@v4/, "release workflow must upload build artifacts");
assert.match(workflow, /dist\/\*\*/, "release workflow must upload the same dist scope covered by checksums");
assert.match(workflow, /!dist\/win-unpacked\/\*\*/, "release workflow must exclude unpacked build output from uploaded artifacts");
assert.match(workflow, /LINGXY_RELEASE_REF_NAME/, "release workflow must pass GitHub context to PowerShell through env");
assert.match(workflow, /gh release create/, "release workflow must support draft GitHub Release creation");
assert.match(workflow, /gh release upload/, "release workflow must support updating an existing release");
assert.match(workflow, /\$tag -notmatch '\^v\\d\+\\\.\\d\+\\\.\\d\+/, "release workflow must validate release tag shape before publishing");
assert.match(workflow, /release artifacts are empty/, "release workflow must reject empty artifact sets before publishing");
assert.match(workflow, /\\win-unpacked\\/, "release workflow must reject win-unpacked assets before publishing");
assert.match(workflow, /dist\\checksums\.sha256/, "release workflow publish preflight must require checksums.sha256");
assert.match(workflow, /dist\\LICENSE/, "release workflow publish preflight must require LICENSE");
assert.match(workflow, /dist\\THIRD_PARTY_LICENSES\.md/, "release workflow publish preflight must require third-party notices");
assert.match(workflow, /checksums\.sha256 must include/, "release workflow must verify required files are covered by checksums");

assert.match(repoBaseline, /node-version:\s+"22\.12\.0"/, "repo baseline must use the documented Node baseline");
assert.match(repoBaseline, /verify:dependency-hygiene/, "repo baseline must run dependency hygiene verification");
assert.match(repoBaseline, /verify:browser-runmode-router/, "repo baseline must run browser route boundary verification");
assert.match(repoBaseline, /verify:browser-extension/, "repo baseline must run browser extension verification");
assert.match(repoBaseline, /verify:browser-ui-click-smoke/, "repo baseline must run browser UI click smoke verification");
assert.match(repoBaseline, /verify:audio-entrypoints/, "repo baseline must run audio entrypoint verification");
assert.match(releaseGate, /node-version:\s+"22\.12\.0"/, "release gate must use the documented Node baseline");
assert.match(releaseGate, /npm run verify:audit-high/, "release gate must block high/critical npm advisories");

assert.equal(packageJson.scripts["verify:release-artifact-workflow"], "node scripts/verify-release-artifact-workflow.mjs");
assert.equal(packageJson.scripts["verify:dependency-hygiene"], "node scripts/verify-dependency-hygiene.mjs");
assert.equal(packageJson.scripts["verify:audit-high"], "npm audit --audit-level=high");
assert.ok(CHECK_COMMANDS.includes("node scripts/verify-release-artifact-workflow.mjs"),
  "npm run check must include release artifact workflow verification");
assert.ok(CHECK_COMMANDS.includes("node scripts/verify-dependency-hygiene.mjs"),
  "npm run check must include dependency hygiene verification");

assert.match(releaseChecklist, /Release Artifacts/, "release checklist must mention the release artifact workflow");
assert.match(releaseChecklist, /checksums\.sha256/, "release checklist must require checksum review");
assert.match(releaseChecklist, /THIRD_PARTY_LICENSES\.md/, "release checklist must require third-party notice artifacts");
assert.match(readme, /Release Artifacts/, "README must document the release artifact workflow");

console.log("Release artifact workflow verification passed.");
