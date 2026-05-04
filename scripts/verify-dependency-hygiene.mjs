#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const thirdPartyLicenses = readFileSync(path.join(repoRoot, "THIRD_PARTY_LICENSES.md"), "utf8");

const forbiddenPackages = new Set([
  "buffers"
]);

const directDependencyNames = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {})
]);

for (const packageName of forbiddenPackages) {
  assert.equal(
    directDependencyNames.has(packageName),
    false,
    `forbidden direct dependency remains in package.json: ${packageName}`
  );
}

const lockedPackageNames = new Set();
for (const [lockPath, info] of Object.entries(packageLock.packages ?? {})) {
  if (!lockPath.includes("node_modules/")) continue;
  const pathName = lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
  const packageName = info.name ?? pathName;
  lockedPackageNames.add(packageName);
}

for (const packageName of forbiddenPackages) {
  assert.equal(
    lockedPackageNames.has(packageName),
    false,
    `forbidden dependency remains in package-lock.json: ${packageName}`
  );
}

assert.equal(
  /\|\s*UNKNOWN\s*\|/u.test(thirdPartyLicenses),
  false,
  "third-party license inventory must not contain UNKNOWN license rows"
);

assert.equal(
  /buffers\s*\|/iu.test(thirdPartyLicenses),
  false,
  "third-party license inventory must not contain the removed buffers package"
);

console.log("Dependency hygiene verification passed.");
