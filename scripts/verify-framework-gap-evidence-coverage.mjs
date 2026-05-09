#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const gap = read("FRAMEWORK_GAP_ANALYSIS.md");
const plan = read("FUNCTION_AUDIT_AND_UPGRADE_PLAN.md");

function parseGapEvidenceSections(source) {
  const sections = [];
  let current = null;
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = lines[index].match(/^###\s+(\d+\.\d+)\s+(.+)$/u);
    if (sectionMatch) {
      current = {
        id: sectionMatch[1],
        title: sectionMatch[2].trim(),
        labels: new Set()
      };
      sections.push(current);
      continue;
    }
    const labelMatch = lines[index].match(/^####\s+(.+)$/u);
    if (!labelMatch || !current) continue;
    const label = labelMatch[1].trim();
    if (/现状/u.test(label)) current.labels.add("现状");
    if (/根因/u.test(label)) current.labels.add("根因");
    if (/影响估算|用户感知|价值/u.test(label)) current.labels.add("影响");
  }
  return sections.filter((section) => section.labels.size > 0);
}

const evidenceSections = parseGapEvidenceSections(gap);
assert.ok(evidenceSections.length >= 20, "FRAMEWORK_GAP_ANALYSIS evidence parser found too few sections");

const coverageStart = plan.indexOf("## 2.2 FRAMEWORK_GAP_ANALYSIS Evidence Coverage");
assert.ok(coverageStart >= 0, "root plan must include a granular FRAMEWORK_GAP_ANALYSIS evidence coverage section");
const nextHeading = plan.indexOf("\n## ", coverageStart + 1);
const coverage = plan.slice(coverageStart, nextHeading >= 0 ? nextHeading : undefined);

for (const section of evidenceSections) {
  const row = coverage
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`| §${section.id} |`));
  assert.ok(row, `missing granular evidence row for §${section.id} ${section.title}`);
  for (const label of section.labels) {
    assert.ok(row.includes(label), `coverage row for §${section.id} must mention ${label}`);
  }
  assert.match(row, /(FW-\d{3}|AUDIT-\d{3})/u,
    `coverage row for §${section.id} must map to an executable upgrade/audit task`);
}

console.log("framework gap evidence coverage ok");
