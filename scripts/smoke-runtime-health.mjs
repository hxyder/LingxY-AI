#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = Number(process.env.UCA_PUBLIC_SMOKE_PORT || 4390);
const baseUrl = `http://127.0.0.1:${port}`;
const pipeName = process.env.UCA_PUBLIC_SMOKE_PIPE_NAME
  || `\\\\.\\pipe\\lingxy-public-smoke-${process.pid}-${Date.now()}`;
const output = [];

async function probe(timeoutMs = 1500) {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

if (await probe(500)) {
  throw new Error(`Port ${port} already has a LingxY runtime; stop it before running smoke:runtime`);
}

const child = spawn(process.execPath, ["scripts/start-runtime.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, UCA_PORT: String(port), UCA_EXPLORER_PIPE_NAME: pipeName },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => output.push(String(chunk)));
child.stderr.on("data", (chunk) => output.push(String(chunk)));

let health = null;
const deadline = Date.now() + 60000;
try {
  while (Date.now() < deadline) {
    health = await probe(1500);
    if (health?.ok === true) break;
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  if (health?.ok !== true) {
    throw new Error(`Runtime did not become healthy on ${baseUrl}. Output:\n${output.join("").slice(-4000)}`);
  }
  console.log(`runtime health smoke ok: ${baseUrl}`);
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await sleep(1000);
}
