// Convenience wrapper for the 100-case function audit corpus.
//
// Keeps the existing run-corpus.mjs runner as the single implementation while
// giving the upgrade plan a stable command name.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(__dirname, "run-corpus.mjs");
const corpus = "./corpus-function-audit-100.mjs";

const child = spawn(process.execPath, [runner, "--corpus", corpus, ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, "..", ".."),
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
