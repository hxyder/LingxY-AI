import { spawn } from "node:child_process";

function run(command, args, options = {}) {
  const shell = options.shell ?? (process.platform === "win32");
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: "inherit",
        shell
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

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const builderArgs = ["electron-builder", ...process.argv.slice(2)];

const prepareExitCode = await run(process.execPath, ["scripts/prepare-release-oauth-clients.mjs"], { shell: false });
if (prepareExitCode !== 0) {
  process.exit(prepareExitCode);
}

const nativeHostExitCode = await run(process.execPath, ["scripts/prepare-native-host-release.mjs"], { shell: false });
if (nativeHostExitCode !== 0) {
  process.exit(nativeHostExitCode);
}

const builderExitCode = await run(npxCommand, builderArgs);
const rebuildExitCode = await run(npmCommand, ["rebuild", "better-sqlite3"]);

if (rebuildExitCode !== 0) {
  console.error("Failed to rebuild better-sqlite3 for the current Node.js runtime after electron-builder.");
  process.exit(rebuildExitCode);
}

process.exit(builderExitCode);
