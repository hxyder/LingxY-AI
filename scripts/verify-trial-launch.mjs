import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const result = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `& { try { & '${path.join(repoRoot, "scripts", "verify-trial-launch.ps1").replace(/'/g, "''")}' } catch { Write-Error $_; exit 1 }; exit 0 }`
  ],
  {
    cwd: repoRoot,
    encoding: "utf8"
  }
);

assert.equal(
  result.stdout.includes("Trial desktop launch verification passed."),
  true,
  result.stderr || result.stdout || "trial launch verification did not report success"
);

console.log("Trial desktop launch verification passed.");
