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
    templatesDir: path.join(resolvedBaseDir, "data", "templates"),
    integrationsDir: path.join(resolvedBaseDir, "data", "integrations"),
    mcpDir: path.join(resolvedBaseDir, "data", "integrations", "mcp"),
    skillsDir: path.join(resolvedBaseDir, "data", "integrations", "skills"),
    codeCliDir: path.join(resolvedBaseDir, "data", "integrations", "code_cli"),
    historyDir: path.join(resolvedBaseDir, "data", "history"),
    historyStorePath: path.join(resolvedBaseDir, "data", "history", "embeddings.json"),
    skillPatternsPath: path.join(resolvedBaseDir, "data", "skill-patterns.json"),
    notesPath: path.join(resolvedBaseDir, "data", "notes.json"),
    previewCacheDir: path.join(resolvedBaseDir, "data", "preview-cache"),
    dagDir: path.join(resolvedBaseDir, "data", "dag"),
    dagRunsDir: path.join(resolvedBaseDir, "data", "dag", "runs"),
    budgetStatePath: path.join(resolvedBaseDir, "data", "budget.json"),
    logsDir: path.join(resolvedBaseDir, "logs"),
    outputsDir: path.join(resolvedBaseDir, "outputs")
  };
}

export function ensureRuntimePaths(paths) {
  for (const directory of [
    paths.baseDir,
    paths.configDir,
    paths.dataDir,
    paths.templatesDir,
    paths.integrationsDir,
    paths.mcpDir,
    paths.skillsDir,
    paths.codeCliDir,
    paths.historyDir,
    paths.dagDir,
    paths.dagRunsDir,
    paths.logsDir,
    paths.outputsDir,
    paths.previewCacheDir
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}
