import { mkdirSync } from "node:fs";
import path from "node:path";

export function resolveRuntimeBaseDir(baseDir = null) {
  if (baseDir) {
    return path.resolve(baseDir);
  }

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "UCA");
  }

  return path.join(process.cwd(), ".uca-runtime");
}

export function resolveRuntimePaths({ baseDir = null } = {}) {
  const resolvedBaseDir = resolveRuntimeBaseDir(baseDir);
  return {
    baseDir: resolvedBaseDir,
    configDir: path.join(resolvedBaseDir, "config"),
    configPath: path.join(resolvedBaseDir, "config", "runtime.json"),
    dataDir: path.join(resolvedBaseDir, "data"),
    dbPath: path.join(resolvedBaseDir, "data", "uca.db"),
    logsDir: path.join(resolvedBaseDir, "logs"),
    outputsDir: path.join(resolvedBaseDir, "outputs")
  };
}

export function ensureRuntimePaths(paths) {
  for (const directory of [paths.baseDir, paths.configDir, paths.dataDir, paths.logsDir, paths.outputsDir]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}
