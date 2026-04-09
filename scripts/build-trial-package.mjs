import crypto from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseConfig = JSON.parse(readFileSync(path.join(repoRoot, "tools", "release", "release-config.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const bundleRoot = path.join(repoRoot, "dist", "trial", releaseConfig.trial_version);

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

rmSync(bundleRoot, { recursive: true, force: true });
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
  "Run `node scripts/start-runtime.mjs` or start the packaged runtime host",
  "Install Explorer entry with `scripts/install-explorer-entry.ps1`",
  "Install browser native host with `scripts/install-native-host.ps1`",
  "Sideload browser extension from `browser_ext/`",
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
  `UCA trial bundle: ${releaseConfig.trial_version}\n\n${installChecklist.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n`
);

console.log(`Trial package generated at ${bundleRoot}`);
