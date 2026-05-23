import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function resolveDefaultOutputDir(ctx) {
  const configuredDir = ctx?.runtime?.configStore?.load?.()?.output?.defaultDir;
  if (configuredDir && typeof configuredDir === "string" && configuredDir.trim()) return configuredDir.trim();
  return ctx?.outputDir ?? path.join(os.homedir(), "Documents", "UCA");
}

export async function readManifest(outputDir) {
  const manifestPath = path.join(outputDir, ".uca-manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeManifest(outputDir, entries) {
  const manifestPath = path.join(outputDir, ".uca-manifest.json");
  await mkdir(outputDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

export function globToRegex(pattern) {
  const normalized = String(pattern ?? "").replace(/\\/g, "/");
  const braceGroups = [];
  const withBraceTokens = normalized.replace(/\{([^{}]+)\}/g, (_match, body) => {
    const alternatives = String(body).split(",").map((item) => item.trim()).filter(Boolean);
    if (alternatives.length === 0) return "";
    const index = braceGroups.push(alternatives) - 1;
    return `__BRACE_${index}__`;
  });
  const escaped = withBraceTokens.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let converted = escaped
    .replace(/\*\*\//g, "__GLOBSTAR_DIR__")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/__GLOBSTAR_DIR__/g, "(?:.*[/\\\\])?")
    .replace(/__GLOBSTAR__/g, ".*");
  for (const [index, alternatives] of braceGroups.entries()) {
    const escapedAlternatives = alternatives.map((item) => item.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
    converted = converted.replace(
      new RegExp(`__BRACE_${index}__`, "g"),
      `(?:${escapedAlternatives.join("|")})`
    );
  }
  return new RegExp(`^${converted}$`, "i");
}
