import crypto from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseConfig = JSON.parse(readFileSync(path.join(repoRoot, "tools", "release", "release-config.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const bundleRoot = path.join(repoRoot, "dist", "trial", releaseConfig.trial_version);
const relativeRepoRootFromBundle = path.relative(bundleRoot, repoRoot).replace(/\\/g, "/") || ".";

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeText(filePath, content) {
  ensureParent(filePath);
  writeFileSync(filePath, content, "utf8");
}

rmSync(bundleRoot, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200
});
mkdirSync(bundleRoot, { recursive: true });

const copiedAssets = [];

for (const relativePath of releaseConfig.required_assets) {
  const sourcePath = path.join(repoRoot, relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`missing_release_asset:${relativePath}`);
  }

  const targetPath = path.join(bundleRoot, relativePath);
  ensureParent(targetPath);
  cpSync(sourcePath, targetPath, { recursive: true });

  const details = statSync(sourcePath);
  copiedAssets.push({
    path: relativePath,
    size: details.size,
    sha256: details.isFile() ? sha256(sourcePath) : null
  });
}

const installChecklist = [
  "Keep this trial bundle inside the repository workspace; it is a repo-local sideload kit, not a standalone installer",
  "Double-click `Check UCA Desktop Trial.cmd` first if you want a quick prerequisite check",
  "Double-click `Setup UCA Desktop Trial.cmd` for the guided desktop-first setup path",
  "Double-click `Launch UCA Desktop Trial.cmd` to start the desktop app and local runtime together",
  "Explorer entry is the default recommended integration for first use",
  "Install browser native host only when you need browser capture",
  "Sideload browser extension from `browser_ext/` when webpage capture is needed",
  "Sideload Office add-in manifests from `office_addin/` as needed",
  "Verify Kimi CLI availability before first task submission"
];

const releaseManifest = {
  product: "Universal Context Agent",
  package_version: packageJson.version,
  trial_version: releaseConfig.trial_version,
  channel: releaseConfig.channel,
  generated_at: new Date().toISOString(),
  bundle_name: releaseConfig.bundle_name,
  root: path.relative(repoRoot, bundleRoot).replace(/\\/g, "/"),
  assets: copiedAssets,
  install_checklist: installChecklist,
  validation_targets: releaseConfig.validation_targets
};

writeText(
  path.join(bundleRoot, "release-manifest.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`
);

writeText(
  path.join(bundleRoot, "checksums.sha256"),
  `${copiedAssets
    .filter((asset) => asset.sha256)
    .map((asset) => `${asset.sha256}  ${asset.path}`)
    .join("\n")}\n`
);

writeText(
  path.join(bundleRoot, "INSTALL.txt"),
  [
    `UCA trial bundle: ${releaseConfig.trial_version}`,
    "",
    "This bundle is intended to be used from the repository workspace that generated it.",
    "Optional first step: Check UCA Desktop Trial.cmd",
    "Recommended first step: Setup UCA Desktop Trial.cmd",
    "Primary entry: Launch UCA Desktop Trial.cmd",
    "Stop entry: Stop UCA Desktop Trial.cmd",
    "",
    ...installChecklist.map((step, index) => `${index + 1}. ${step}`)
  ].join("\n") + "\n"
);

writeText(
  path.join(bundleRoot, "Check UCA Desktop Trial.cmd"),
  [
    "@echo off",
    "setlocal",
    `set "REPO_ROOT=%~dp0${relativeRepoRootFromBundle.replaceAll("/", "\\")}"`,
    'powershell -ExecutionPolicy Bypass -File "%REPO_ROOT%\\scripts\\check-trial-prereqs.ps1"',
    "pause",
    "endlocal",
    ""
  ].join("\r\n")
);

writeText(
  path.join(bundleRoot, "Setup UCA Desktop Trial.cmd"),
  [
    "@echo off",
    "setlocal",
    `set "REPO_ROOT=%~dp0${relativeRepoRootFromBundle.replaceAll("/", "\\")}"`,
    'powershell -ExecutionPolicy Bypass -File "%REPO_ROOT%\\scripts\\setup-trial.ps1"',
    "endlocal",
    ""
  ].join("\r\n")
);

writeText(
  path.join(bundleRoot, "Launch UCA Desktop Trial.cmd"),
  [
    "@echo off",
    "setlocal",
    `set "REPO_ROOT=%~dp0${relativeRepoRootFromBundle.replaceAll("/", "\\")}"`,
    'powershell -ExecutionPolicy Bypass -File "%REPO_ROOT%\\scripts\\start-trial.ps1"',
    "endlocal",
    ""
  ].join("\r\n")
);

writeText(
  path.join(bundleRoot, "Stop UCA Desktop Trial.cmd"),
  [
    "@echo off",
    "setlocal",
    `set "REPO_ROOT=%~dp0${relativeRepoRootFromBundle.replaceAll("/", "\\")}"`,
    'powershell -ExecutionPolicy Bypass -File "%REPO_ROOT%\\scripts\\stop-trial.ps1"',
    "endlocal",
    ""
  ].join("\r\n")
);

console.log(`Trial package generated at ${bundleRoot}`);
