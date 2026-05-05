import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseManualReleasePassRows } from "./release-manual-pass.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseConfig = JSON.parse(readFileSync(path.join(repoRoot, "tools", "release", "release-config.json"), "utf8"));
const bundleRoot = path.join(repoRoot, "dist", "trial", releaseConfig.trial_version);

execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-trial-package.mjs")], {
  cwd: repoRoot,
  stdio: "pipe"
});

const prereqJson = execFileSync("powershell", [
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  path.join(repoRoot, "scripts", "check-trial-prereqs.ps1"),
  "-Json"
], {
  cwd: repoRoot,
  stdio: "pipe",
  encoding: "utf8"
});

const prereqs = JSON.parse(prereqJson);
const manifest = JSON.parse(readFileSync(path.join(bundleRoot, "release-manifest.json"), "utf8"));
const installText = readFileSync(path.join(bundleRoot, "INSTALL.txt"), "utf8");
const e2eMatrix = readFileSync(path.join(repoRoot, "docs", "release", "e2e_matrix.md"), "utf8");
const functionalMatrix = readFileSync(path.join(repoRoot, "docs", "release", "functional_acceptance_matrix.md"), "utf8");
const knownIssues = readFileSync(path.join(repoRoot, "docs", "release", "known_issues.md"), "utf8");
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  stdio: "pipe",
  encoding: "utf8"
}).trim();
const gitStatus = execFileSync("git", ["status", "--short"], {
  cwd: repoRoot,
  stdio: "pipe",
  encoding: "utf8"
}).trim();

const report = {
  generated_at: new Date().toISOString(),
  trial_version: releaseConfig.trial_version,
  git_head: gitHead,
  workspace_clean: gitStatus.length === 0,
  prereqs,
  manifest_summary: {
    channel: manifest.channel,
    asset_count: manifest.assets.length,
    validation_targets: manifest.validation_targets
  },
  install_entrypoints: [
    "Check LingxY Desktop Trial.cmd",
    "Setup LingxY Desktop Trial.cmd",
    "Launch LingxY Desktop Trial.cmd",
    "Stop LingxY Desktop Trial.cmd"
  ],
  manual_remaining: parseManualReleasePassRows(functionalMatrix).map((row) => `${row.area}: ${row.manualPass}`)
};

const markdown = [
  `# Trial Readiness Report — ${releaseConfig.trial_version}`,
  "",
  `Generated at: ${report.generated_at}`,
  `Git HEAD: ${report.git_head}`,
  `Workspace clean: ${report.workspace_clean ? "yes" : "no"}`,
  "",
  "## Preflight",
  "",
  ...report.prereqs.checks.map((check) => `- [${check.ok ? "x" : check.severity === "required" ? "!" : "~"}] \`${check.name}\`: ${check.detail}`),
  "",
  `Required failures: ${report.prereqs.requiredFailures}`,
  `Recommended failures: ${report.prereqs.recommendedFailures}`,
  "",
  "## Bundle",
  "",
  `- Channel: ${report.manifest_summary.channel}`,
  `- Asset count: ${report.manifest_summary.asset_count}`,
  `- Validation targets: ${report.manifest_summary.validation_targets.join(", ")}`,
  "",
  "## Trial Entrypoints",
  "",
  ...report.install_entrypoints.map((entry) => `- ${entry}`),
  "",
  "## Remaining Manual Validation",
  "",
  ...report.manual_remaining.map((item) => `- ${item}`),
  "",
  "## Install Excerpt",
  "",
  "```text",
  ...installText.trimEnd().split(/\r?\n/),
  "```",
  "",
  "## E2E Matrix Reference",
  "",
  ...e2eMatrix.trimEnd().split(/\r?\n/).slice(0, 20),
  "",
  "## Known Issues Reference",
  "",
  ...knownIssues.trimEnd().split(/\r?\n/)
].join("\n");

writeFileSync(path.join(bundleRoot, "TRIAL_READINESS_REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(path.join(bundleRoot, "TRIAL_READINESS_REPORT.md"), `${markdown}\n`, "utf8");

if (!existsSync(path.join(bundleRoot, "TRIAL_READINESS_REPORT.md")) || !existsSync(path.join(bundleRoot, "TRIAL_READINESS_REPORT.json"))) {
  throw new Error("failed_to_write_trial_readiness_report");
}

console.log(`Trial readiness report generated at ${bundleRoot}`);
