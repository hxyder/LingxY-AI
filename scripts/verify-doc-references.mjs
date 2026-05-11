#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function trackedFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return raw.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/")).sort();
}

const sourceExtensions = new Set([".cjs", ".css", ".html", ".js", ".mjs", ".ts", ".tsx"]);
const genericDocFilenames = new Set(["SKILL.md"]);
const markdownRefPattern = /(?<![\p{L}\p{N}_.-])((?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_][\p{L}\p{N}_.-]*\.md)(?:#[^\s)`'"]+)?/giu;

function isSourceFile(file) {
  return file.startsWith("src/") && sourceExtensions.has(path.extname(file).toLowerCase());
}

function isCommentLikeLine(line) {
  return line.includes("//")
    || line.includes("/*")
    || line.trimStart().startsWith("*")
    || line.includes("<!--");
}

function candidatePaths(fromFile, rawReference) {
  const reference = rawReference.replaceAll("\\", "/");
  const candidates = [];
  if (reference.includes("/")) {
    candidates.push(reference);
    candidates.push(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), reference)));
  } else {
    candidates.push(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), reference)));
    candidates.push(reference);
  }
  return [...new Set(candidates)];
}

function referenceExists(fromFile, rawReference) {
  if (genericDocFilenames.has(path.posix.basename(rawReference))) return true;
  return candidatePaths(fromFile, rawReference).some((candidate) => existsSync(repoPath(candidate)));
}

const missing = [];
for (const file of trackedFiles().filter(isSourceFile).filter((file) => existsSync(repoPath(file)))) {
  const text = readFileSync(repoPath(file), "utf8");
  const lines = text.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (!line.includes(".md") || !isCommentLikeLine(line)) continue;
    markdownRefPattern.lastIndex = 0;
    for (const match of line.matchAll(markdownRefPattern)) {
      const reference = match[1];
      if (!referenceExists(file, reference)) {
        missing.push(`${file}:${index + 1} references missing Markdown doc: ${reference}`);
      }
    }
  }
}

assert.deepEqual(missing, [], `Missing Markdown references in source comments:\n${missing.join("\n")}`);

console.log("Source Markdown reference verification passed.");
