#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`[stale-owner] ${message}`);
  process.exitCode = 1;
}

// AGENTS.md sweep rule: after every migration, prove no old-owner text
// assertions remain in active source, docs, scripts, or package config.

// Phase 2B: electron-main.mjs extracted helpers
const phase2bOldOwners = [
  { old: "tray/desktop-window-lifecycle.mjs", new: "shell/desktop-window-lifecycle.mjs" },
  { old: "tray/desktop-window-actions.mjs", new: "shell/desktop-window-actions.mjs" },
  { old: "tray/desktop-shortcut-router.mjs", new: "shell/desktop-shortcut-router.mjs" },
  { old: "tray/desktop-link-browser-window.mjs", new: "shell/desktop-link-browser-window.mjs" },
  { old: "tray/desktop-preview-window-manager.mjs", new: "shell/desktop-preview-window-manager.mjs" },
  { old: "tray/desktop-permission-handler.mjs", new: "shell/desktop-permission-handler.mjs" },
  { old: "tray/desktop-gui-smoke-runner.mjs", new: "smoke/desktop-gui-smoke-runner.mjs" },
];

// Phase REPO-1: moved IPC modules
const phaseRepo1OldOwners = [
  { old: "tray/ipc/", new: "main/ipc/" },
  { old: "tray/desktop-payload-normalizers.mjs", new: "shared/desktop-payload-normalizers.mjs" },
];

const phaseCap1OldOwners = [
  { old: "action_tools/tools/vision-analyze.mjs", new: "capabilities/tools/vision-analyze.mjs" },
  { old: "action_tools/tools/browser-web-tools.mjs", new: "capabilities/tools/browser-web-tools.mjs" },
  { old: "action_tools/tools/email-tools.mjs", new: "capabilities/tools/email-tools.mjs" },
  { old: "action_tools/tools/file-manifest-helpers.mjs", new: "capabilities/tools/file-manifest-helpers.mjs" },
  { old: "action_tools/tools/os-app-tools.mjs", new: "capabilities/tools/os-app-tools.mjs" },
  { old: "action_tools/tools/file-read-tools.mjs", new: "capabilities/tools/file-read-tools.mjs" },
  { old: "action_tools/tools/open-with-default-handler.mjs", new: "capabilities/tools/open-with-default-handler.mjs" },
  { old: "action_tools/tools/scheduler-tools.mjs", new: "capabilities/tools/scheduler-tools.mjs" },
  { old: "action_tools/tools/memory-tools.mjs", new: "capabilities/tools/memory-tools.mjs" },
  { old: "action_tools/tools/skill-install-tools.mjs", new: "capabilities/tools/skill-install-tools.mjs" },
  { old: "action_tools/tools/document-renderer.mjs", new: "capabilities/tools/document-renderer.mjs" },
  { old: "action_tools/tools/svg-sanitize.mjs", new: "capabilities/tools/svg-sanitize.mjs" },
  { old: "action_tools/tools/mermaid-assets.mjs", new: "capabilities/tools/mermaid-assets.mjs" },
];
const phaseCap2OldOwners = [
  { old: "action_tools/schemas/index.mjs", new: "capabilities/schemas/index.mjs" },
];
const phaseCap3OldOwners = [
  { old: "action_tools/registry.mjs", new: "capabilities/registry/registry.mjs" },
  { old: "action_tools/types.mjs", new: "capabilities/registry/types.mjs" },
  { old: "action_tools/risk_matrix.mjs", new: "capabilities/registry/risk_matrix.mjs" },
  { old: "action_tools/policy-guard.mjs", new: "capabilities/registry/policy-guard.mjs" },
];
const phaseCap4ASkillOldOwners = [
  { old: "ai/skills/builtin.mjs", new: "capabilities/skills/builtin.mjs" },
  { old: "ai/skills/discovery.mjs", new: "capabilities/skills/discovery.mjs" },
  { old: "ai/skills/github-install.mjs", new: "capabilities/skills/github-install.mjs" },
  { old: "ai/skills/install-state.mjs", new: "capabilities/skills/install-state.mjs" },
  { old: "ai/skills/lifecycle.mjs", new: "capabilities/skills/lifecycle.mjs" },
  { old: "ai/skills/registry-validation.mjs", new: "capabilities/skills/registry-validation.mjs" },
  { old: "ai/skills/registry.mjs", new: "capabilities/skills/registry.mjs" },
  { old: "src/service/ai/skills/", new: "src/service/capabilities/skills/" },
];
const allMoved = [
  ...phase2bOldOwners,
  ...phaseRepo1OldOwners,
  ...phaseCap1OldOwners,
  ...phaseCap2OldOwners,
  ...phaseCap3OldOwners,
  ...phaseCap4ASkillOldOwners
];

// Post-migration: old physical paths must not exist as reachable files.
// Compatibility barrels are disallowed under the no-short-term-fallback rule.
const forbiddenExistingPaths = [
  "src/service/action_tools/tools/vision-analyze.mjs",
  "src/service/action_tools/tools/browser-web-tools.mjs",
  "src/desktop/tray/desktop-payload-normalizers.mjs",
  "src/service/action_tools/tools/email-tools.mjs",
  "src/service/action_tools/tools/file-manifest-helpers.mjs",
  "src/service/action_tools/tools/file-read-tools.mjs",
  "src/service/action_tools/tools/open-with-default-handler.mjs",
  "src/service/action_tools/tools/os-app-tools.mjs",
  "src/service/action_tools/tools/scheduler-tools.mjs",
  "src/service/action_tools/tools/memory-tools.mjs",
  "src/service/action_tools/tools/skill-install-tools.mjs",
  "src/service/action_tools/tools/document-renderer.mjs",
  "src/service/action_tools/tools/svg-sanitize.mjs",
  "src/service/action_tools/tools/mermaid-assets.mjs",
  "src/service/action_tools/schemas/index.mjs",
  "src/service/action_tools/registry.mjs",
  "src/service/action_tools/types.mjs",
  "src/service/action_tools/risk_matrix.mjs",
  "src/service/action_tools/policy-guard.mjs",
  "src/service/ai/skills",
];
for (const rel of forbiddenExistingPaths) {
  const absolute = path.join(root, rel);
  if (existsSync(absolute)) {
    fail(`${rel} still exists after migration (barrel not allowed under no-short-term-fallback rule)`);
  }
}

// Scan: walk all source files (not node_modules, not .git)
function walk(dir, files = []) {
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  if (!existsSync(absoluteDir)) return files;
  for (const e of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const fp = path.join(absoluteDir, e.name);
    if (e.isDirectory()) walk(fp, files);
    else if (/\.(mjs|js|cjs|md|json|html|css)$/.test(e.name)) files.push(fp);
  }
  return files;
}

const allFiles = [...walk("src"), ...walk("scripts"), ...walk("docs"), ...walk("tests")];
for (const rel of ["package.json", "index.cjs", "AGENTS.md", "CLAUDE.md"]) {
  const absolute = path.join(root, rel);
  if (existsSync(absolute) && statSync(absolute).isFile()) allFiles.push(absolute);
}

for (const file of allFiles) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  // Skip handoff history (audit trail, not active claims)
  if (rel.includes("handoff/current-status")) continue;
  // Skip the verifier itself (it checks for old paths)
  if (rel === "scripts/verify-stale-owner-paths.mjs") continue;
  // Skip repo-directory verifier: it intentionally owns old-path guard strings.
  if (rel === "scripts/verify-repository-directory-architecture.mjs") continue;
  // Skip tool-registry verifier: CAP-1 closure intentionally checks old paths
  if (rel === "scripts/verify-tool-registry-snapshot.mjs") continue;
  // Skip vision contract verifier: it intentionally guards the old CAP-1 path.
  if (rel === "scripts/verify-vision-analyze-contract.mjs") continue;
  // Skip moved tool-family contract verifiers: they intentionally guard old
  // CAP-1 owner paths so compatibility barrels cannot return.
  if (rel === "scripts/verify-memory-tools-contract.mjs") continue;
  if (rel === "scripts/verify-skill-install-tools-contract.mjs") continue;
  if (rel === "scripts/verify-document-renderer-contract.mjs") continue;
  if (rel === "scripts/verify-svg-sanitize-contract.mjs") continue;
  if (rel === "scripts/verify-mermaid-assets-contract.mjs") continue;
  if (rel === "scripts/verify-action-tool-schemas-contract.mjs") continue;
  if (rel === "scripts/verify-action-tool-registry-contract.mjs") continue;
  if (rel === "scripts/verify-skill-surface-contract.mjs") continue;
  // Skip the plan document (historical, not active)
  if (rel === "linxi_codebase_reorganization_execution_plan.md") continue;

  const content = readFileSync(file, "utf8");
  for (const { old: oldPath, new: newPath } of allMoved) {
    let index = content.indexOf(oldPath);
    while (index !== -1) {
      // Skip historical "moved from X → Y" documentation of the move itself
      const context = content.substring(index - 30, index + oldPath.length + 30);
      if (context.includes("moved from") || context.includes("←")) {
        index = content.indexOf(oldPath, index + oldPath.length);
        continue;
      }
      fail(`${rel} still references ${oldPath} (should be ${newPath})`);
      break;
    }
  }
}

if (!process.exitCode) {
  console.log("[stale-owner] stale-owner path sweep clean");
}
