import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const lockPath = path.join(repoRoot, "package-lock.json");
const outputPath = path.join(repoRoot, "THIRD_PARTY_LICENSES.md");

function packageNameFromLockPath(lockPackagePath) {
  const marker = "node_modules/";
  const index = lockPackagePath.lastIndexOf(marker);
  if (index < 0) return null;
  return lockPackagePath.slice(index + marker.length);
}

function normalizeLicense(license) {
  if (!license) return "UNKNOWN";
  if (typeof license === "string") return license;
  if (typeof license === "object" && typeof license.type === "string") return license.type;
  return "SEE PACKAGE";
}

function normalizeRepository(repository) {
  if (!repository) return "";
  if (typeof repository === "string") return repository;
  if (typeof repository === "object" && typeof repository.url === "string") return repository.url;
  return "";
}

function escapeMarkdownTableCell(value = "") {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

async function readPackageJson(packageName) {
  try {
    const packageJsonPath = path.join(repoRoot, "node_modules", ...packageName.split("/"), "package.json");
    return JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return {};
  }
}

async function inferLicenseFromLicenseFile(packageName) {
  const packageDir = path.join(repoRoot, "node_modules", ...packageName.split("/"));
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md", "license.txt"]) {
    try {
      const text = await readFile(path.join(packageDir, filename), "utf8");
      if (/MIT License|The MIT License/i.test(text)) return "MIT";
      if (/Apache License[\s\S]{0,120}Version 2\.0/i.test(text)) return "Apache-2.0";
      if (/BSD 2-Clause|Redistribution and use in source and binary forms/i.test(text)) return "BSD";
    } catch {
      // try the next common license filename
    }
  }
  return "";
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
const packages = lock.packages ?? {};
const rows = [];

for (const [lockPackagePath, lockInfo] of Object.entries(packages)) {
  if (!lockPackagePath || !lockPackagePath.includes("node_modules/")) continue;
  const name = lockInfo.name ?? packageNameFromLockPath(lockPackagePath);
  if (!name) continue;
  const packageJson = await readPackageJson(name);
  const version = lockInfo.version ?? packageJson.version ?? "";
  const inferredLicense = await inferLicenseFromLicenseFile(name);
  rows.push({
    name,
    version,
    license: normalizeLicense(lockInfo.license ?? packageJson.license ?? inferredLicense),
    homepage: lockInfo.homepage ?? packageJson.homepage ?? "",
    repository: normalizeRepository(lockInfo.repository ?? packageJson.repository),
    dev: Boolean(lockInfo.dev),
    optional: Boolean(lockInfo.optional),
    resolved: lockInfo.resolved ?? ""
  });
}

rows.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

const licenseCounts = new Map();
for (const row of rows) {
  licenseCounts.set(row.license, (licenseCounts.get(row.license) ?? 0) + 1);
}

const lines = [
  "# Third-Party Licenses",
  "",
  "Generated from `package-lock.json` and installed package metadata.",
  "",
  `- Total packages: ${rows.length}`,
  `- Production packages: ${rows.filter((row) => !row.dev).length}`,
  `- Development-only packages: ${rows.filter((row) => row.dev).length}`,
  "",
  "## License Summary",
  "",
  "| License | Count |",
  "|---|---:|",
  ...[...licenseCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([license, count]) => `| ${escapeMarkdownTableCell(license)} | ${count} |`),
  "",
  "## Package Inventory",
  "",
  "| Package | Version | License | Scope | Source |",
  "|---|---:|---|---|---|"
];

for (const row of rows) {
  const source = row.homepage || row.repository || row.resolved || "";
  const scope = row.dev ? "dev" : "prod";
  lines.push(`| ${escapeMarkdownTableCell(row.name)} | ${escapeMarkdownTableCell(row.version)} | ${escapeMarkdownTableCell(row.license)} | ${scope}${row.optional ? ", optional" : ""} | ${escapeMarkdownTableCell(source)} |`);
}

lines.push(
  "",
  "## Notes",
  "",
  "- This file is an inventory, not legal advice.",
  "- Package-level license text remains in `node_modules/<package>/LICENSE*` when published by the package author.",
  "- Regenerate with `npm run licenses` after dependency changes.",
  ""
);

await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(`Wrote ${rows.length} package entries to ${path.relative(repoRoot, outputPath)}`);
