#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  return {
    fast: argv.includes("--fast"),
    list: argv.includes("--list")
  };
}

function runCommand(command, index, total) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`\n[${index + 1}/${total}] ${command}`);
    const child = spawn(command, {
      cwd: repoRoot,
      env: process.env,
      shell: true,
      stdio: "inherit"
    });
    child.on("close", (code, signal) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[ok ${elapsed}s] ${command}`);
        resolve(0);
      } else {
        console.error(`[failed ${elapsed}s] ${command}${signal ? ` (${signal})` : ""}`);
        resolve(code || 1);
      }
    });
    child.on("error", (err) => {
      console.error(`[error] ${command}: ${err.message}`);
      resolve(1);
    });
  });
}

const args = parseArgs(process.argv.slice(2));
const commands = args.fast ? FAST_CHECK_COMMANDS : CHECK_COMMANDS;

if (args.list) {
  for (const command of commands) console.log(command);
  process.exit(0);
}

for (let i = 0; i < commands.length; i += 1) {
  const code = await runCommand(commands[i], i, commands.length);
  if (code !== 0) process.exit(code);
}

console.log(`\nAll ${commands.length} check command(s) passed.`);
