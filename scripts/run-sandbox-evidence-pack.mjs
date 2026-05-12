#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildSandboxEvidencePack,
  redactSandboxEvidencePack,
  validateSandboxEvidencePack
} from "../src/shared/sandbox-evidence-pack.mjs";

const SURFACE_COMMANDS = Object.freeze({
  file_mutation: Object.freeze([
    "node scripts/verify-write-edit-run-tools-contract.mjs",
    "node scripts/verify-file-reversibility-checkpoint.mjs"
  ]),
  command_execution: Object.freeze([
    "node scripts/verify-security-broker.mjs",
    "node scripts/verify-permission-mode-model.mjs"
  ]),
  mcp_install: Object.freeze([
    "node scripts/verify-mcp-surface-contract.mjs",
    "node scripts/verify-mcp-governance-policy.mjs"
  ]),
  ocr: Object.freeze([
    "node scripts/verify-pdf-ocr.mjs",
    "node scripts/verify-artifact-sandbox-invariants.mjs"
  ]),
  browser_automation: Object.freeze([
    "node scripts/verify-browser-runmode-router.mjs",
    "node scripts/verify-browser-overlay.mjs",
    "node scripts/verify-browser-extension.mjs"
  ]),
  audio_daemon: Object.freeze([
    "node scripts/verify-real-audio-kws-fixtures.mjs",
    "node scripts/verify-desktop-audio-hardware-smoke-contract.mjs"
  ])
});

const MITIGATION = Object.freeze({
  file_mutation: "approval gate, file checkpoint, path budget, and artifact sandbox invariants",
  command_execution: "security broker, permission mode contract, and explicit high-risk confirmation",
  mcp_install: "MCP governance policy, descriptor validation, and disabled-by-default external capability management",
  ocr: "artifact sandbox allowlist and bounded OCR/document extraction lanes",
  browser_automation: "browser run-mode routing, UI click smoke, and explicit external surface ownership",
  audio_daemon: "fixture-first audio checks, daemon circuit breaker, and opt-in hardware smoke contract"
});

function parseArgs(argv) {
  const out = {
    outputDir: path.resolve(".tmp", "sandbox-evidence-pack")
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-dir") out.outputDir = path.resolve(argv[++i]);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

function currentGit(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

function runCommand(command) {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return {
    command,
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status,
    outputHead: output.slice(0, 500)
  };
}

function buildSurface(id, commands) {
  const results = commands.map((command) => runCommand(command));
  const failed = results.filter((result) => result.status !== "pass");
  return {
    id,
    status: failed.length === 0 ? "pass" : "fail",
    command: commands.join(" && "),
    evidence: results.map((result) =>
      `${result.command} => exit=${result.exitCode}; ${result.outputHead.split(/\r?\n/).at(-1) ?? ""}`
    ).join(" | "),
    measured: true,
    mitigation: MITIGATION[id],
    notes: failed.length === 0 ? "" : `failed commands: ${failed.map((result) => result.command).join(", ")}`
  };
}

function writePack(pack) {
  mkdirSync(ARGS.outputDir, { recursive: true });
  const file = path.join(ARGS.outputDir, `report-${nowStamp()}.json`);
  writeFileSync(file, JSON.stringify(redactSandboxEvidencePack(pack), null, 2), "utf8");
  return file;
}

const surfaces = Object.entries(SURFACE_COMMANDS).map(([id, commands]) => buildSurface(id, commands));
const pack = buildSandboxEvidencePack({
  commit: currentGit(["rev-parse", "--short", "HEAD"]),
  branch: currentGit(["branch", "--show-current"]),
  boundaryChange: false,
  surfaces,
  notes: ["SBOX-001 evidence-only run; no sandbox boundary changed"]
});
const file = writePack(pack);
const validation = validateSandboxEvidencePack(pack);

console.log(JSON.stringify({
  ok: validation.ok,
  report: path.relative(process.cwd(), file),
  missing: validation.missing,
  leaks: validation.leaks,
  failedSurfaces: pack.surfaces.filter((surface) => surface.status === "fail").map((surface) => surface.id)
}, null, 2));

if (!validation.ok || pack.surfaces.some((surface) => surface.status === "fail")) {
  process.exitCode = 1;
}
