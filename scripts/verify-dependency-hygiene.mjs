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
  "buffers",
  "@modelcontextprotocol/server-brave-search",
  "@modelcontextprotocol/server-puppeteer"
]);

const minimumVersions = new Map([
  ["@modelcontextprotocol/sdk", {
    floor: "1.25.2",
    reason: "known MCP SDK advisories below 1.25.2 (GHSA-8r9q-7v3j-jr4g, GHSA-w48q-cv73-mx4w)"
  }]
]);

function compareVersions(a, b) {
  const left = `${a ?? ""}`.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = `${b ?? ""}`.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

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
const lockedPackages = [];
for (const [lockPath, info] of Object.entries(packageLock.packages ?? {})) {
  if (!lockPath.includes("node_modules/")) continue;
  const pathName = lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
  const packageName = info.name ?? pathName;
  lockedPackageNames.add(packageName);
  lockedPackages.push({ lockPath, packageName, info });
}

for (const packageName of forbiddenPackages) {
  assert.equal(
    lockedPackageNames.has(packageName),
    false,
    `forbidden dependency remains in package-lock.json: ${packageName}`
  );
}

for (const { lockPath, packageName, info } of lockedPackages) {
  const rule = minimumVersions.get(packageName);
  if (!rule) continue;
  assert.ok(
    compareVersions(info.version, rule.floor) >= 0,
    `${packageName} must be >=${rule.floor} (${rule.reason}); found ${info.version} at ${lockPath}`
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
