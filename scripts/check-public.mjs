#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const forbiddenPaths = [
  ".tmp",
  ".venv",
  "dist",
  "models",
  "internal",
  "docs/architecture",
  "docs/release",
  "scripts/real-llm-test",
  "scripts/real-connector-test"
];
const requiredPaths = [
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "package.json",
  "src/service/core/policy/success-contract-validator.mjs",
  "src/desktop/renderer/i18n-dom.mjs",
  "src/desktop/renderer/i18n-dom-bootstrap.mjs",
  "scripts/start-runtime.mjs",
  "scripts/start-desktop.mjs",
  "scripts/smoke-ui-i18n.mjs",
  "tests/behavior/success-contract-validation-spec.test.mjs",
  "tests/behavior/security-sanitizers.test.mjs",
  "tests/behavior/tool-call-validator-side-effect.test.mjs"
];
const ignoredDirs = new Set([".git", "node_modules", "dist", ".tmp", ".cache", "coverage"]);
const binaryExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".wav", ".mp3", ".pdf", ".docx", ".xlsx", ".pptx", ".zip", ".exe", ".dll", ".node"]);
const secretPatterns = [
  [/(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{16,}/, "OpenAI-style API key"],
  [/ghp_[A-Za-z0-9_]{20,}/, "GitHub token"],
  [/AIza[0-9A-Za-z_-]{20,}/, "Google API key"],
  [/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/, "private key"],
  [/xox[baprs]-[A-Za-z0-9-]{20,}/, "Slack token"]
];

for (const rel of requiredPaths) {
  assert.equal(existsSync(path.join(root, rel)), true, `missing required public path: ${rel}`);
}
for (const rel of forbiddenPaths) {
  assert.equal(existsSync(path.join(root, rel)), false, `forbidden public path exists: ${rel}`);
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(pkg.private, false, "public package must not be marked private");
assert.equal(typeof pkg.scripts?.["check:public"], "string", "check:public script missing");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
assert.match(gitignore, /(^|\r?\n)node_modules\/(\r?\n|$)/, ".gitignore must exclude node_modules");
for (const key of Object.keys(pkg.scripts ?? {})) {
  assert.equal(key.startsWith("verify:"), false, `internal verify script leaked into public package.json: ${key}`);
  assert.equal(key.startsWith("real-llm:"), false, `live LLM script leaked into public package.json: ${key}`);
}

const leaks = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (binaryExts.has(path.extname(entry.name).toLowerCase())) continue;
    const size = statSync(full).size;
    if (size > 2_000_000) continue;
    const text = readFileSync(full, "utf8");
    for (const [regex, label] of secretPatterns) {
      if (regex.test(text)) leaks.push(`${rel}: ${label}`);
    }
  }
}
walk(root);
assert.deepEqual(leaks, [], `potential secrets found:\n${leaks.join("\n")}`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

run(process.execPath, [
  "--test",
  "tests/behavior/success-contract-validation-spec.test.mjs",
  "tests/behavior/security-sanitizers.test.mjs",
  "tests/behavior/tool-call-validator-side-effect.test.mjs"
]);
run(process.execPath, ["scripts/smoke-ui-i18n.mjs"]);
run(process.execPath, ["scripts/smoke-desktop-entrypoints.mjs"]);
run(process.execPath, ["scripts/smoke-runtime-health.mjs"]);

console.log("public check ok");
