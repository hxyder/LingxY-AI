#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function printHelp() {
  console.log([
    "Usage: node scripts/redact-screenshot.mjs <input-image> <output-image> --box=x,y,w,h [--box=x,y,w,h ...]",
    "",
    "Draws opaque rectangles over sensitive screenshot regions using ffmpeg.",
    "",
    "Options:",
    "  --box=x,y,w,h       Rectangle in pixels. May be repeated.",
    "  --color=<value>     ffmpeg drawbox color. Default: black@1",
    "",
    "Example:",
    "  node scripts/redact-screenshot.mjs raw.png assets/screenshots/console-workbench.png --box=32,80,420,44 --box=900,20,260,60"
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    boxes: [],
    color: "black@1"
  };
  const positional = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--box=")) {
      options.boxes.push(arg.slice("--box=".length));
      continue;
    }
    if (arg.startsWith("--color=")) {
      options.color = arg.slice("--color=".length).trim() || "black@1";
      continue;
    }
    positional.push(arg);
  }
  return { options, positional };
}

function parseBox(raw) {
  const parts = String(raw).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid --box value "${raw}". Expected x,y,w,h.`);
  }
  const [x, y, w, h] = parts.map((part) => Math.round(part));
  if (x < 0 || y < 0 || w <= 0 || h <= 0) {
    throw new Error(`Invalid --box value "${raw}". x/y must be >= 0 and w/h must be > 0.`);
  }
  return { x, y, w, h };
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", args, {
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) {
    throw new Error(`ffmpeg failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with status ${result.status}`);
  }
}

const { options, positional } = parseArgs(process.argv.slice(2));
if (options.help || positional.length < 2) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

if (options.boxes.length === 0) {
  throw new Error("At least one --box=x,y,w,h region is required.");
}

const input = path.resolve(positional[0]);
const output = path.resolve(positional[1]);
if (!existsSync(input)) {
  throw new Error(`Input image not found: ${input}`);
}

const filters = options.boxes
  .map(parseBox)
  .map((box) => `drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=${options.color}:t=fill`)
  .join(",");

runFfmpeg([
  "-y",
  "-i", input,
  "-vf", filters,
  "-frames:v", "1",
  output
]);

console.log(`Created redacted screenshot: ${output}`);
