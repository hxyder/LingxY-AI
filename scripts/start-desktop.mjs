import { spawn } from "node:child_process";
import electronPath from "electron";

const serviceBaseUrl = process.env.UCA_SERVICE_BASE_URL ?? "http://127.0.0.1:4310";

async function isRuntimeReady() {
  try {
    const response = await fetch(`${serviceBaseUrl}/health`, {
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForRuntime(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRuntimeReady()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.UCA_SERVICE_BASE_URL = serviceBaseUrl;
env.LINGXY_DESKTOP_DISABLE_EMBEDDED_SERVICE = "1";

let runtimeChild = null;
if (!(await isRuntimeReady())) {
  runtimeChild = spawn(process.execPath, ["scripts/start-runtime.mjs"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: false
  });

  runtimeChild.on("exit", (code, signal) => {
    runtimeChild = null;
    if (code && code !== 0) {
      console.error(`LingxY runtime exited before desktop shutdown (code ${code}${signal ? `, signal ${signal}` : ""}).`);
    }
  });
  // Start Electron immediately instead of blocking the desktop shell on the
  // service health check. Renderers already tolerate a not-yet-ready runtime,
  // so this restores the fast "window appears first, service catches up" feel.
  waitForRuntime().then((ready) => {
    if (!ready) {
      console.error(`LingxY runtime did not become ready at ${serviceBaseUrl}`);
    }
  }).catch((error) => {
    console.error(`LingxY runtime readiness check failed: ${error.message}`);
  });
}

let shuttingDown = false;
function stopRuntime() {
  if (shuttingDown || !runtimeChild) {
    return;
  }
  shuttingDown = true;
  runtimeChild.kill();
}

const child = spawn(electronPath, [".", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: false
});

process.on("SIGINT", () => {
  stopRuntime();
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  stopRuntime();
  child.kill("SIGTERM");
});

child.on("exit", (code, signal) => {
  stopRuntime();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
