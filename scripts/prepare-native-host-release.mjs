#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: "inherit",
        shell: process.platform === "win32",
        ...options
      });
    } catch (error) {
      console.error(error.message);
      resolve(1);
      return;
    }
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
  });
}

const repoRoot = process.cwd();
const projectPath = path.join(repoRoot, "uca-native-host", "UcaNativeHost", "UcaNativeHost.csproj");
const outputDir = path.join(repoRoot, ".tmp", "release", "native-host", "win-x64");

if (process.platform !== "win32") {
  console.log("Skipping Windows native host publish on non-Windows platform.");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

const exitCode = await run("dotnet", [
  "publish",
  projectPath,
  "-c",
  "Release",
  "-r",
  "win-x64",
  "--self-contained",
  "true",
  "-p:PublishSingleFile=true",
  "-p:PublishTrimmed=false",
  "-o",
  outputDir
]);

if (exitCode !== 0) {
  console.error("Failed to publish the self-contained browser native host.");
  process.exit(exitCode);
}
