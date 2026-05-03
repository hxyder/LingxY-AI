import path from "node:path";

const NPM_PACKAGE_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._+:-]*)?$/i;
const GITHUB_HTTPS_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/][^\s]*)?$/;

function normalizePathSegment(value) {
  return `${value ?? ""}`
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
}

function packageNameFromSpec(spec) {
  const value = `${spec ?? ""}`.trim();
  if (value.startsWith("@")) {
    const parts = value.split("/");
    if (parts.length < 2) return value;
    const namePart = parts[1].replace(/@[^@/]+$/, "");
    return `${parts[0]}/${namePart}`;
  }
  return value.replace(/@[^@/]+$/, "");
}

function splitPackageName(packageName) {
  return packageName.split("/").filter(Boolean);
}

function isInsideDirectory(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === "" || Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function classifyMcpInstallSource(source) {
  const value = `${source ?? ""}`.trim();
  if (!value) {
    return { ok: false, error: "MCP install source is required." };
  }

  const githubMatch = value.match(GITHUB_HTTPS_RE);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    return {
      ok: true,
      type: "github",
      source: value,
      packageName: repo.replace(/\.git$/i, ""),
      defaultId: normalizePathSegment(`${owner}-${repo.replace(/\.git$/i, "")}`)
    };
  }

  if (NPM_PACKAGE_RE.test(value)) {
    const packageName = packageNameFromSpec(value);
    return {
      ok: true,
      type: "npm",
      source: value,
      packageName,
      defaultId: normalizePathSegment(packageName)
    };
  }

  return {
    ok: false,
    error: "MCP install source must be an npm package name or an https://github.com/owner/repo URL."
  };
}

export function createMcpInstallSandboxPlan({
  source,
  paths = {},
  id = "",
  allowScripts = false
} = {}) {
  const classified = classifyMcpInstallSource(source);
  if (!classified.ok) {
    return { ok: false, errors: [{ field: "source", message: classified.error }] };
  }

  const installRoot = paths.mcpInstallDir;
  if (!installRoot) {
    return { ok: false, errors: [{ field: "mcpInstallDir", message: "MCP install sandbox directory is not configured." }] };
  }

  const installId = normalizePathSegment(id) || classified.defaultId;
  if (!installId) {
    return { ok: false, errors: [{ field: "id", message: "Could not derive a safe MCP install id." }] };
  }

  const packageRoot = path.join(installRoot, installId);
  const nodeModulesDir = path.join(packageRoot, "node_modules");
  const packageDir = path.join(nodeModulesDir, ...splitPackageName(classified.packageName));
  const lockfilePath = path.join(packageRoot, "package-lock.json");
  if (!isInsideDirectory(packageRoot, installRoot) || !isInsideDirectory(packageDir, installRoot)) {
    return { ok: false, errors: [{ field: "id", message: "MCP install id resolved outside the install sandbox." }] };
  }

  const installArgs = [
    "install",
    "--prefix",
    packageRoot,
    "--no-audit",
    "--no-fund",
    "--package-lock=true"
  ];
  if (!allowScripts) {
    installArgs.push("--ignore-scripts");
  }
  installArgs.push(classified.source);

  return {
    ok: true,
    source: classified.source,
    sourceType: classified.type,
    id: installId,
    installRoot: packageRoot,
    packageDir,
    packageJsonPath: path.join(packageDir, "package.json"),
    lockfilePath,
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: installArgs,
    allowScripts: Boolean(allowScripts),
    cleanupOnFailure: true
  };
}
