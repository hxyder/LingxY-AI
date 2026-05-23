import { existsSync, statSync } from "node:fs";
import path from "node:path";

function cleanPath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pathExists(value) {
  try {
    return Boolean(value && existsSync(value));
  } catch {
    return false;
  }
}

function normalizeResourcesPath({ env = process.env, processResourcesPath = process.resourcesPath } = {}) {
  const explicit = cleanPath(env.UCA_APP_RESOURCES_PATH ?? env.LINGXY_APP_RESOURCES_PATH);
  if (explicit) return path.resolve(explicit);
  return cleanPath(processResourcesPath) ? path.resolve(processResourcesPath) : null;
}

export function resolveDesktopResourcePath(relativePath, {
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  preferResources = false
} = {}) {
  const normalizedRelativePath = String(relativePath ?? "").replace(/^[/\\]+/, "");
  const resourcesPath = normalizeResourcesPath({ env, processResourcesPath });
  const candidates = [];
  const cwdCandidate = { path: path.resolve(cwd, normalizedRelativePath), source: "workspace" };
  const resourcesCandidate = resourcesPath
    ? { path: path.join(resourcesPath, normalizedRelativePath), source: "packaged_resources" }
    : null;

  if (preferResources && resourcesCandidate) candidates.push(resourcesCandidate);
  candidates.push(cwdCandidate);
  if (!preferResources && resourcesCandidate) candidates.push(resourcesCandidate);

  const selected = candidates.find((candidate) => pathExists(candidate.path)) ?? candidates[0] ?? {
    path: path.resolve(cwd, normalizedRelativePath),
    source: "workspace"
  };

  return {
    ...selected,
    available: pathExists(selected.path),
    isDirectory: (() => {
      try { return statSync(selected.path).isDirectory(); }
      catch { return false; }
    })(),
    candidates: candidates.map((candidate) => ({
      ...candidate,
      available: pathExists(candidate.path)
    }))
  };
}
