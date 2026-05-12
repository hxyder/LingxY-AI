import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnExternal } from "../../core/external-call.mjs";
import { validateMcpServerDescriptor } from "./descriptor-validation.mjs";
import { detectMcpInstallCandidate } from "./install-detection.mjs";
import { createMcpInstallSandboxPlan } from "./install-sandbox.mjs";

const DEFAULT_INSTALL_TIMEOUT_MS = 120_000;
const OUTPUT_TAIL_LIMIT = 4000;

function tail(value, limit = OUTPUT_TAIL_LIMIT) {
  const text = `${value ?? ""}`;
  return text.length > limit ? text.slice(-limit) : text;
}

function rebasePlanPath(filePath, fromRoot, toRoot) {
  return path.join(toRoot, path.relative(fromRoot, filePath));
}

function replacePrefixArg(args = [], prefixValue) {
  const next = [...args];
  const prefixIndex = next.indexOf("--prefix");
  if (prefixIndex >= 0 && prefixIndex + 1 < next.length) {
    next[prefixIndex + 1] = prefixValue;
  }
  return next;
}

function buildStagingPlan(plan, { now = Date.now, randomId = randomUUID } = {}) {
  const stagingRoot = `${plan.installRoot}.staging-${now()}-${randomId()}`;
  return {
    ...plan,
    finalInstallRoot: plan.installRoot,
    finalPackageDir: plan.packageDir,
    installRoot: stagingRoot,
    packageDir: rebasePlanPath(plan.packageDir, plan.installRoot, stagingRoot),
    packageJsonPath: rebasePlanPath(plan.packageJsonPath, plan.installRoot, stagingRoot),
    lockfilePath: rebasePlanPath(plan.lockfilePath, plan.installRoot, stagingRoot),
    args: replacePrefixArg(plan.args, stagingRoot),
    stagingRoot
  };
}

async function defaultInstallRunner(stagePlan, { timeoutMs, signal } = {}) {
  return spawnExternal(stagePlan.command, stagePlan.args, {
    timeoutMs,
    label: "mcp_install",
    signal,
    settleOnSignal: "close"
  });
}

async function cleanupStaging(stagePlan, removeDir) {
  try {
    await removeDir(stagePlan.stagingRoot);
    return { cleanupFailed: false };
  } catch (error) {
    return {
      cleanupFailed: true,
      cleanupError: error?.message ?? String(error),
      stagingPath: stagePlan.stagingRoot
    };
  }
}

function failurePayload(error, stagePlan, result = {}, cleanup = {}) {
  return {
    ok: false,
    error,
    installRoot: stagePlan?.finalInstallRoot ?? stagePlan?.installRoot ?? null,
    packageDir: stagePlan?.finalPackageDir ?? stagePlan?.packageDir ?? null,
    stagingPath: cleanup.stagingPath ?? stagePlan?.stagingRoot ?? null,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    timedOut: Boolean(result.timedOut),
    cleanup_failed: Boolean(cleanup.cleanupFailed),
    cleanup_error: cleanup.cleanupError ?? null
  };
}

export async function executeMcpInstall({
  source,
  id = "",
  paths = {},
  allowScripts = false,
  timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS,
  signal = null,
  runner = defaultInstallRunner,
  detectCandidate = detectMcpInstallCandidate,
  validateDescriptor = validateMcpServerDescriptor,
  pathExists = existsSync,
  makeDir = (dir) => mkdir(dir, { recursive: true }),
  removeDir = (dir) => rm(dir, { recursive: true, force: true }),
  renameDir = rename,
  now = Date.now,
  randomId = randomUUID
} = {}) {
  const plan = createMcpInstallSandboxPlan({
    source,
    id,
    paths,
    allowScripts
  });
  if (!plan.ok) {
    return plan;
  }

  if (pathExists(plan.installRoot)) {
    return {
      ok: false,
      error: "mcp_install_target_exists",
      errors: [{
        field: "id",
        message: "An MCP install already exists for this id. Remove it or choose a different id."
      }],
      installRoot: plan.installRoot
    };
  }

  const stagePlan = buildStagingPlan(plan, { now, randomId });
  await makeDir(stagePlan.stagingRoot);

  const result = await runner(stagePlan, { timeoutMs, signal });
  if (!result?.ok) {
    const cleanup = await cleanupStaging(stagePlan, removeDir);
    return failurePayload(result?.timedOut ? "external_call_timeout" : "mcp_install_failed", stagePlan, result, cleanup);
  }

  const detected = await detectCandidate({
    packageDir: stagePlan.packageDir,
    packageName: plan.source,
    id: plan.id
  });
  if (!detected.ok) {
    const cleanup = await cleanupStaging(stagePlan, removeDir);
    return {
      ...failurePayload("mcp_manifest_not_detected", stagePlan, result, cleanup),
      errors: detected.errors ?? []
    };
  }

  const validation = validateDescriptor(detected.detected);
  if (!validation.ok) {
    const cleanup = await cleanupStaging(stagePlan, removeDir);
    return {
      ...failurePayload("mcp_install_candidate_invalid", stagePlan, result, cleanup),
      errors: validation.errors ?? [],
      detected: detected.detected
    };
  }

  try {
    await renameDir(stagePlan.stagingRoot, plan.installRoot);
  } catch (error) {
    const cleanup = await cleanupStaging(stagePlan, removeDir);
    return {
      ...failurePayload("mcp_install_publish_failed", stagePlan, result, cleanup),
      publish_error: error?.message ?? String(error)
    };
  }

  return {
    ok: true,
    source: plan.source,
    sourceType: plan.sourceType,
    installRoot: plan.installRoot,
    packageDir: plan.packageDir,
    server: validation.server,
    detection: {
      source: detected.source,
      manifestSource: detected.detected.manifestSource ?? null,
      sourceOfArgs: detected.detected.sourceOfArgs ?? null
    },
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    allowScripts: plan.allowScripts
  };
}
