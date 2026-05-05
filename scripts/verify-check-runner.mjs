import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const runnerSource = readFileSync("scripts/run-checks.mjs", "utf8");

assert.equal(pkg.scripts.check, "node scripts/run-checks.mjs",
  "package.json scripts.check must use the shared check runner");
assert.equal(pkg.scripts["check:fast"], "node scripts/run-checks.mjs --fast",
  "package.json must expose check:fast for the local inner loop");
assert.equal(pkg.scripts["verify:check-runner"], "node scripts/verify-check-runner.mjs",
  "package.json must expose verify:check-runner");

for (const file of [
  "scripts/run-checks.mjs",
  "scripts/check-manifest.mjs",
  "scripts/verify-check-runner.mjs"
]) {
  assert.ok(existsSync(file), `${file} must exist`);
}

assert.ok(CHECK_COMMANDS.length > 100, "full check manifest must preserve the existing broad gate");
assert.ok(FAST_CHECK_COMMANDS.length >= 5, "fast check manifest must include more than one smoke");
assert.deepEqual(new Set(CHECK_COMMANDS).size, CHECK_COMMANDS.length,
  "full check manifest must not contain duplicate commands");
assert.deepEqual(new Set(FAST_CHECK_COMMANDS).size, FAST_CHECK_COMMANDS.length,
  "fast check manifest must not contain duplicate commands");

for (const command of CHECK_COMMANDS) {
  assert.match(command, /^node scripts\/verify-[\w-]+\.mjs$/,
    `full check command must stay a deterministic verifier: ${command}`);
  const scriptPath = command.replace(/^node\s+/, "");
  assert.ok(existsSync(scriptPath), `full check command target must exist: ${scriptPath}`);
}
for (const command of FAST_CHECK_COMMANDS) {
  assert.ok(CHECK_COMMANDS.includes(command),
    `fast check command must also be part of the full gate: ${command}`);
}

assert.ok(runnerSource.includes("from \"./check-manifest.mjs\""),
  "run-checks.mjs must import the manifest instead of owning a second command list");
assert.equal(/verify-[\w-]+\.mjs/.test(runnerSource), false,
  "run-checks.mjs must not embed verifier command names outside the manifest");
assert.ok(runnerSource.includes("fileURLToPath(import.meta.url)"),
  "run-checks.mjs must resolve repo root from its own file, not caller cwd");

for (const required of [
  "node scripts/verify-structure.mjs",
  "node scripts/verify-check-runner.mjs",
  "node scripts/verify-behavior-tests.mjs",
  "node scripts/verify-functional-acceptance.mjs",
  "node scripts/verify-release-readiness.mjs"
]) {
  assert.ok(CHECK_COMMANDS.includes(required), `full check manifest missing ${required}`);
}

for (const requiredFast of [
  "node scripts/verify-structure.mjs",
  "node scripts/verify-check-runner.mjs",
  "node scripts/verify-behavior-tests.mjs",
  "node scripts/verify-user-interaction-smoke.mjs"
]) {
  assert.ok(FAST_CHECK_COMMANDS.includes(requiredFast), `fast check manifest missing ${requiredFast}`);
}

console.log("ok verify-check-runner");
