#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

function readWorkflow(fileName) {
  return readFileSync(path.join(workflowsDir, fileName), "utf8");
}

function topLevelPermissionsBlock(text) {
  const match = /^permissions:\r?\n((?:  [^\r\n]*\r?\n)+)/mu.exec(text);
  return match?.[1] ?? "";
}

function topLevelPermissionValue(text, key) {
  const block = topLevelPermissionsBlock(text);
  const match = new RegExp(`^  ${key}:\\s*([^\\r\\n#]+)`, "mu").exec(block);
  return match?.[1]?.trim() ?? null;
}

function permissionEntries(block, indentation) {
  const entries = [];
  const pattern = new RegExp(`^${" ".repeat(indentation)}([A-Za-z0-9_-]+):\\s*([^\\r\\n#]+)`, "gmu");
  for (const match of block.matchAll(pattern)) {
    entries.push([match[1], match[2].trim()]);
  }
  return entries;
}

function jobSections(text) {
  const jobsIndex = text.search(/^jobs:\s*$/mu);
  if (jobsIndex < 0) return [];
  const jobsText = text.slice(jobsIndex);
  const sections = [];
  const pattern = /^  ([A-Za-z0-9_-]+):\r?\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:\r?\n|(?![\s\S]))/gmu;
  for (const match of jobsText.matchAll(pattern)) {
    sections.push({ name: match[1], body: match[2] });
  }
  return sections;
}

function jobPermissions(job) {
  const match = /^    permissions:\r?\n((?:      [^\r\n]*\r?\n)+)/mu.exec(job.body);
  return match ? permissionEntries(match[1], 6) : [];
}

const workflows = readdirSync(workflowsDir)
  .filter((fileName) => /\.ya?ml$/iu.test(fileName))
  .sort();

assert.deepEqual(
  workflows,
  ["release-artifacts.yml", "release-gate.yml", "repo-baseline.yml"],
  "workflow permission baseline must be reviewed when workflows are added or removed"
);

const writeAllowedJob = {
  fileName: "release-artifacts.yml",
  jobName: "publish-github-release",
  key: "contents",
  reason: "draft GitHub Release publishing uses gh release create/upload"
};

for (const fileName of workflows) {
  const text = readWorkflow(fileName);
  assert.doesNotMatch(
    text,
    /^permissions:\s*\{/mu,
    `${fileName} must use block-form permissions so scoped permissions are reviewable`
  );
  const contentsPermission = topLevelPermissionValue(text, "contents");
  assert.ok(contentsPermission, `${fileName} must declare top-level contents permission`);
  assert.equal(contentsPermission, "read", `${fileName} must be read-only by default`);

  const topLevelWrites = permissionEntries(topLevelPermissionsBlock(text), 2)
    .filter(([key, value]) => key !== "contents" || value !== "read")
    .filter(([, value]) => value !== "none");
  assert.deepEqual(topLevelWrites, [], `${fileName} has unexpected top-level permissions: ${JSON.stringify(topLevelWrites)}`);

  assert.doesNotMatch(
    text,
    /permissions:\s*(?:write-all|read-all)\b/iu,
    `${fileName} must use explicit scoped permissions instead of all-permission shortcuts`
  );

  const elevatedJobPermissions = [];
  for (const job of jobSections(text)) {
    assert.doesNotMatch(
      job.body,
      /^    permissions:\s*\{/mu,
      `${fileName} job ${job.name} must use block-form permissions`
    );
    for (const [key, value] of jobPermissions(job)) {
      if (value === "write") {
        elevatedJobPermissions.push({ job: job.name, key, value });
      }
    }
  }

  const expectedElevated = fileName === writeAllowedJob.fileName
    ? [{ job: writeAllowedJob.jobName, key: writeAllowedJob.key, value: "write" }]
    : [];
  assert.deepEqual(
    elevatedJobPermissions,
    expectedElevated,
    `${fileName} job-level write permissions must be explicitly reviewed`
  );

  if (fileName === writeAllowedJob.fileName) {
    assert.match(text, /gh release (?:create|upload)/u, `${fileName} needs ${writeAllowedJob.reason}`);
  }
}

console.log("Workflow permission verification passed.");
