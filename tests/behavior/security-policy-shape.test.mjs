import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("public security policy exposes the required disclosure sections", () => {
  const text = read("SECURITY.md");
  const headings = new Set(
    text
      .split(/\r?\n/u)
      .map((line) => /^##\s+(.+?)\s*$/u.exec(line)?.[1]?.toLowerCase())
      .filter(Boolean)
  );
  assert.ok(headings.has("reporting a vulnerability"));
  assert.ok(headings.has("scope"));
  assert.ok(headings.has("out of scope"));
  assert.ok(headings.has("disclosure timeline"));
  assert.ok(headings.has("supported versions"));
});

test("dependabot monitors npm and GitHub Actions with load-bearing ignores", () => {
  const text = read(".github/dependabot.yml");
  assert.match(text, /^version:\s*2\s*$/m);
  assert.match(text, /package-ecosystem:\s*"npm"/);
  assert.match(text, /package-ecosystem:\s*"github-actions"/);
  assert.match(text, /dependency-name:\s*"electron"/);
  assert.match(text, /dependency-name:\s*"unzipper"/);
  assert.match(text, /dependency-name:\s*"uuid"/);
});
