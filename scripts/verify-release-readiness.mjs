import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseConfigPath = path.join(repoRoot, "tools", "release", "release-config.json");
const releaseConfig = JSON.parse(readFileSync(releaseConfigPath, "utf8"));

for (const relativePath of [
  "docs/release/README.md",
  "docs/release/e2e_matrix.md",
  "docs/release/functional_acceptance_matrix.md",
  "docs/release/known_issues.md",
  "docs/release/rollback_plan.md",
  "docs/release/trial_release_notes_v0.1.0-trial.1.md",
  "docs/release/external_trial_checklist.md",
  "docs/release/trial_feedback_template.md",
  "scripts/build-trial-package.mjs",
  "tools/release/README.md",
  "tools/release/release-config.json"
]) {
  assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `missing ${relativePath}`);
}

execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-trial-package.mjs")], {
  cwd: repoRoot,
  stdio: "pipe"
});

execFileSync(process.execPath, [path.join(repoRoot, "scripts", "generate-trial-readiness-report.mjs")], {
  cwd: repoRoot,
  stdio: "pipe"
});

const trialLaunchResult = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `& { try { & '${path.join(repoRoot, "scripts", "verify-trial-launch.ps1").replace(/'/g, "''")}' } catch { Write-Error $_; exit 1 }; exit 0 }`
  ],
  {
    cwd: repoRoot,
    encoding: "utf8"
  }
);
assert.equal(
  trialLaunchResult.stdout.includes("Trial desktop launch verification passed."),
  true,
  trialLaunchResult.stderr || trialLaunchResult.stdout || "trial launch verification did not report success"
);

const bundleRoot = path.join(repoRoot, "dist", "trial", releaseConfig.trial_version);
const manifestPath = path.join(bundleRoot, "release-manifest.json");
const checksumsPath = path.join(bundleRoot, "checksums.sha256");
const installPath = path.join(bundleRoot, "INSTALL.txt");
const readinessReportMdPath = path.join(bundleRoot, "TRIAL_READINESS_REPORT.md");
const readinessReportJsonPath = path.join(bundleRoot, "TRIAL_READINESS_REPORT.json");
const checkCmdPath = path.join(bundleRoot, "Check LingxY Desktop Trial.cmd");
const setupCmdPath = path.join(bundleRoot, "Setup LingxY Desktop Trial.cmd");
const launchCmdPath = path.join(bundleRoot, "Launch LingxY Desktop Trial.cmd");
const stopCmdPath = path.join(bundleRoot, "Stop LingxY Desktop Trial.cmd");

assert.equal(existsSync(manifestPath), true);
assert.equal(existsSync(checksumsPath), true);
assert.equal(existsSync(installPath), true);
assert.equal(existsSync(readinessReportMdPath), true);
assert.equal(existsSync(readinessReportJsonPath), true);
assert.equal(existsSync(checkCmdPath), true);
assert.equal(existsSync(setupCmdPath), true);
assert.equal(existsSync(launchCmdPath), true);
assert.equal(existsSync(stopCmdPath), true);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.channel, "trial");
assert.equal(manifest.trial_version, releaseConfig.trial_version);
assert.equal(Array.isArray(manifest.assets), true);
assert.equal(manifest.assets.length >= releaseConfig.required_assets.length, true);
assert.equal(manifest.install_checklist.length >= 5, true);

const checksums = readFileSync(checksumsPath, "utf8");
assert.equal(checksums.includes("docs/release/e2e_matrix.md"), true);

const installText = readFileSync(installPath, "utf8");
assert.equal(installText.includes("Check LingxY Desktop Trial.cmd"), true);
assert.equal(installText.includes("Setup LingxY Desktop Trial.cmd"), true);
assert.equal(installText.includes("Launch LingxY Desktop Trial.cmd"), true);
assert.equal(installText.includes("repo-local sideload kit"), true);

const readinessReportText = readFileSync(readinessReportMdPath, "utf8");
assert.equal(readinessReportText.includes("Trial Readiness Report"), true);
assert.equal(readinessReportText.includes("Remaining Manual Validation"), true);

console.log("Release readiness verification passed.");
