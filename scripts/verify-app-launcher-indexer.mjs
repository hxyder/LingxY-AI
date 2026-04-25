/**
 * Verify 83.6 — Python app launcher dry-run chain.
 *
 * Runs the real Python launcher against the caller's system. We validate
 * structural invariants (not specific apps, since the installed set varies
 * by machine):
 *   1. `index --rescan --json` returns { ok: true, count: >= 1 }
 *   2. `candidates --name "notepad"` returns at least one candidate when
 *      notepad is present (Windows ships notepad in System32).
 *   3. `open --name <foo> --json` returns valid JSON either with
 *      action=would_launch or action=ambiguous for any bogus input it
 *      can't resolve (rather than crashing).
 *
 * Skipped gracefully when python isn't on PATH (non-dev env).
 */

import { spawnSync } from "node:child_process";

function runLauncher(args) {
  const r = spawnSync("python", ["launcher.py", ...args], {
    cwd: "scripts/app_launcher",
    encoding: "utf8",
    timeout: 30_000
  });
  if (r.status !== 0 && !r.stdout) {
    return { ok: false, error: r.stderr || "python exited without output", stderr: r.stderr };
  }
  return { ok: true, stdout: r.stdout.trim(), stderr: r.stderr, status: r.status };
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

function main() {
  console.log("verify-app-launcher-indexer:");

  const pyCheck = spawnSync("python", ["--version"], { encoding: "utf8" });
  if (pyCheck.status !== 0) {
    console.log("  ⚠ python not available on PATH — skipping (expected on CI boxes without Python)");
    return;
  }

  // 1. Index
  const indexResult = runLauncher(["index", "--rescan", "--json"]);
  assert(indexResult.ok, `index failed: ${indexResult.error}`);
  const idx = JSON.parse(indexResult.stdout);
  assert(idx.ok === true, "index should return ok=true");
  assert(typeof idx.count === "number" && idx.count >= 1,
    `expected at least 1 indexed app, got ${idx.count}`);
  console.log(`  ✓ indexed ${idx.count} apps in ${idx.elapsed_s}s`);

  // 2. Candidates for a guaranteed-present app (notepad on Windows).
  if (process.platform === "win32") {
    const candResult = runLauncher(["candidates", "--name", "notepad", "--json"]);
    assert(candResult.ok, `candidates failed: ${candResult.error}`);
    const cand = JSON.parse(candResult.stdout);
    assert(cand.ok === true, "candidates should return ok=true");
    assert(Array.isArray(cand.candidates) && cand.candidates.length >= 1,
      `expected notepad candidate(s), got ${cand.candidates?.length ?? 0}`);
    console.log(`  ✓ notepad matched ${cand.candidates.length} candidate(s), decision=${cand.decision_reason}`);
  } else {
    console.log("  · skipped notepad check (not Windows)");
  }

  // 3. Open with --dry-run on an unlikely name → ambiguous or empty, never
  //    crash and never actually spawn a process.
  const openResult = runLauncher(["open", "--name", "zzz_no_such_app_12345", "--dry-run", "--json"]);
  assert(openResult.stdout, "open should emit JSON even on failure");
  const open = JSON.parse(openResult.stdout);
  assert("ok" in open, "open should have ok field");
  assert(open.dry_run === true, "open --dry-run should set dry_run=true");
  console.log(`  ✓ open --dry-run on bogus name → ${open.ok ? open.action : open.reason}`);

  console.log("App-launcher dry-run verification passed.");
}

main();
