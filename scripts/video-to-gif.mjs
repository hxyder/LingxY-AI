#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function printHelp() {
  console.log([
    "Usage: node scripts/video-to-gif.mjs <input-video> [output-gif] [options]",
    "",
    "Options:",
    "  --fps=<n>        Frames per second for the GIF. Default: 12",
    "  --width=<px>     Output width. Keeps aspect ratio. Default: 960",
    "  --start=<time>   Start time passed to ffmpeg, for example 00:00:02",
    "  --duration=<s>   Duration in seconds",
    "",
    "Example:",
    "  node scripts/video-to-gif.mjs demo.mp4 assets/demo/lingxy-page-video-analysis.gif --fps=12 --width=960 --duration=14"
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    fps: 12,
    width: 960,
    start: "",
    duration: ""
  };
  const positional = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--fps=")) {
      options.fps = Number(arg.slice("--fps=".length));
      continue;
    }
    if (arg.startsWith("--width=")) {
      options.width = Number(arg.slice("--width=".length));
      continue;
    }
    if (arg.startsWith("--start=")) {
      options.start = arg.slice("--start=".length);
      continue;
    }
    if (arg.startsWith("--duration=")) {
      options.duration = arg.slice("--duration=".length);
      continue;
    }
    positional.push(arg);
  }
  return { options, positional };
}

function assertNumber(name, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
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
if (options.help || positional.length === 0) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

const input = path.resolve(positional[0]);
const output = path.resolve(positional[1] ?? `${path.basename(input, path.extname(input))}.gif`);

assertNumber("fps", options.fps, 1, 30);
assertNumber("width", options.width, 240, 1920);
if (!existsSync(input)) {
  throw new Error(`Input video not found: ${input}`);
}

const seekArgs = [];
if (options.start) seekArgs.push("-ss", options.start);
if (options.duration) seekArgs.push("-t", options.duration);

const filters = `fps=${Math.round(options.fps)},scale=${Math.round(options.width)}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
runFfmpeg([
  "-y",
  ...seekArgs,
  "-i", input,
  "-vf", filters,
  "-loop", "0",
  output
]);

console.log(`Created GIF: ${output}`);
