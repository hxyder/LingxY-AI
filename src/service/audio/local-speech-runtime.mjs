import { existsSync, statSync } from "node:fs";
import path from "node:path";

export const LOCAL_SPEECH_RUNTIME_SCHEMA_VERSION = 1;
export const DEFAULT_LOCAL_WHISPER_MODEL = "base";
export const DEFAULT_SHERPA_KWS_MODEL_NAME = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";

const SCRIPT_NAMES = Object.freeze({
  whisper: "local-whisper-transcribe.py",
  sherpaKws: "local-sherpa-kws.py"
});
const DEV_LOCAL_SPEECH_RESOURCE_PATH = "external/local-speech-runtime";

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

function directoryExists(value) {
  try {
    return Boolean(value && statSync(value).isDirectory());
  } catch {
    return false;
  }
}

function fileExists(value) {
  try {
    return Boolean(value && statSync(value).isFile());
  } catch {
    return false;
  }
}

function resolveCommandAvailability(command, source) {
  if (!command) return false;
  if (source === "path_lookup") return null;
  return fileExists(command);
}

function normalizeResourcesPath(value) {
  const cleaned = cleanPath(value);
  return cleaned ? path.resolve(cleaned) : null;
}

export function resolveLocalSpeechResourceRoot({
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd()
} = {}) {
  const explicit = cleanPath(env.UCA_LOCAL_SPEECH_RESOURCE_DIR ?? env.LINGXY_LOCAL_SPEECH_RESOURCE_DIR);
  if (explicit) {
    return {
      path: path.resolve(explicit),
      source: "env",
      available: directoryExists(path.resolve(explicit))
    };
  }

  const resourcesPath = normalizeResourcesPath(
    env.UCA_APP_RESOURCES_PATH
      ?? env.LINGXY_APP_RESOURCES_PATH
      ?? processResourcesPath
  );
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, "local-speech");
    return {
      path: packaged,
      source: "packaged_resources",
      available: directoryExists(packaged)
    };
  }

  const dev = path.resolve(cwd, ...DEV_LOCAL_SPEECH_RESOURCE_PATH.split("/"));
  return {
    path: dev,
    source: "dev_external",
    available: directoryExists(dev)
  };
}

function scriptCandidates(kind, {
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd()
} = {}) {
  const scriptName = SCRIPT_NAMES[kind];
  if (!scriptName) throw new Error(`Unknown local speech script kind: ${kind}`);
  const explicitKey = kind === "whisper"
    ? "UCA_LOCAL_WHISPER_SCRIPT_PATH"
    : "UCA_SHERPA_KWS_SCRIPT_PATH";
  const explicit = cleanPath(env[explicitKey]);
  const candidates = [];
  if (explicit) candidates.push({ path: path.resolve(explicit), source: "env" });

  const resourcesPath = normalizeResourcesPath(
    env.UCA_APP_RESOURCES_PATH
      ?? env.LINGXY_APP_RESOURCES_PATH
      ?? processResourcesPath
  );
  if (resourcesPath) {
    candidates.push({ path: path.join(resourcesPath, "scripts", scriptName), source: "packaged_resources" });
  }

  candidates.push({ path: path.resolve(cwd, "scripts", scriptName), source: "workspace" });
  return candidates;
}

export function resolveLocalSpeechScript(kind, options = {}) {
  const candidates = scriptCandidates(kind, options);
  const selected = candidates.find((candidate) => fileExists(candidate.path)) ?? candidates[0];
  return {
    kind,
    path: selected?.path ?? null,
    source: selected?.source ?? "missing",
    available: fileExists(selected?.path),
    candidates: candidates.map((candidate) => ({
      source: candidate.source,
      path: candidate.path,
      available: fileExists(candidate.path)
    }))
  };
}

export function getLocalSpeechScriptPath(kind, options = {}) {
  return resolveLocalSpeechScript(kind, options).path;
}

export function resolveLocalSpeechPython({
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  platform = process.platform
} = {}) {
  const explicit = cleanPath(env.UCA_PYTHON_PATH);
  if (explicit) {
    const command = path.resolve(explicit);
    return {
      command,
      source: "env",
      available: fileExists(command)
    };
  }

  const root = resolveLocalSpeechResourceRoot({ env, processResourcesPath, cwd });
  const bundled = platform === "win32"
    ? path.join(root.path, "python", "python.exe")
    : path.join(root.path, "python", "bin", "python");
  if (fileExists(bundled)) {
    return {
      command: bundled,
      source: "bundled_resource",
      available: true
    };
  }

  const venvPython = platform === "win32"
    ? path.resolve(cwd, ".venv", "Scripts", "python.exe")
    : path.resolve(cwd, ".venv", "bin", "python");
  if (fileExists(venvPython)) {
    return {
      command: venvPython,
      source: "workspace_venv",
      available: true
    };
  }

  return {
    command: platform === "win32" ? "python" : "python3",
    source: "path_lookup",
    available: null
  };
}

export function getLocalSpeechPythonCommand(options = {}) {
  return resolveLocalSpeechPython(options).command;
}

function resolveWhisperModel({
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd()
} = {}) {
  const explicitModel = cleanPath(env.UCA_LOCAL_WHISPER_MODEL);
  if (explicitModel) {
    return {
      model: explicitModel,
      source: pathExists(explicitModel) ? "env_path" : "env_name",
      bundled: false,
      available: pathExists(explicitModel) ? true : null
    };
  }

  const root = resolveLocalSpeechResourceRoot({ env, processResourcesPath, cwd });
  const bundledModel = path.join(root.path, "models", "whisper", DEFAULT_LOCAL_WHISPER_MODEL);
  if (directoryExists(bundledModel)) {
    return {
      model: bundledModel,
      source: "bundled_resource",
      bundled: true,
      available: true
    };
  }

  return {
    model: DEFAULT_LOCAL_WHISPER_MODEL,
    source: "huggingface_or_cache_name",
    bundled: false,
    available: null
  };
}

function resolveSherpaKwsModelDir({
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd()
} = {}) {
  const explicit = cleanPath(env.UCA_SHERPA_KWS_MODEL_DIR);
  if (explicit) {
    const modelDir = path.resolve(explicit);
    return {
      modelDir,
      source: "env",
      bundled: false,
      available: directoryExists(modelDir)
    };
  }

  const root = resolveLocalSpeechResourceRoot({ env, processResourcesPath, cwd });
  const bundled = path.join(root.path, "models", "sherpa-kws", DEFAULT_SHERPA_KWS_MODEL_NAME);
  if (directoryExists(bundled)) {
    return {
      modelDir: bundled,
      source: "bundled_resource",
      bundled: true,
      available: true
    };
  }

  const workspace = path.resolve(cwd, "models", DEFAULT_SHERPA_KWS_MODEL_NAME);
  return {
    modelDir: workspace,
    source: "workspace_models",
    bundled: false,
    available: directoryExists(workspace)
  };
}

export function resolveLocalSpeechRuntime(options = {}) {
  const python = resolveLocalSpeechPython(options);
  const whisperScript = resolveLocalSpeechScript("whisper", options);
  const sherpaScript = resolveLocalSpeechScript("sherpaKws", options);
  const whisperModel = resolveWhisperModel(options);
  const sherpaKws = resolveSherpaKwsModelDir(options);
  const resourceRoot = resolveLocalSpeechResourceRoot(options);

  const localWhisperReady = Boolean(whisperScript.available && python.command);
  const localKwsReady = Boolean(sherpaScript.available && python.command && sherpaKws.available);

  return {
    schemaVersion: LOCAL_SPEECH_RUNTIME_SCHEMA_VERSION,
    resourceRoot,
    python,
    localWhisper: {
      engine: "faster-whisper",
      script: whisperScript,
      model: whisperModel.model,
      modelSource: whisperModel.source,
      modelBundled: whisperModel.bundled,
      modelAvailable: whisperModel.available,
      entrypointAvailable: Boolean(whisperScript.available),
      ready: localWhisperReady,
      dependencyProbe: "deferred_to_helper_check"
    },
    sherpaKws: {
      engine: "sherpa-onnx",
      script: sherpaScript,
      modelDir: sherpaKws.modelDir,
      modelSource: sherpaKws.source,
      modelBundled: sherpaKws.bundled,
      modelAvailable: sherpaKws.available,
      entrypointAvailable: Boolean(sherpaScript.available),
      ready: localKwsReady,
      dependencyProbe: "deferred_to_helper_check"
    },
    install: {
      coreBundled: "scripts_only",
      optionalResourceRoot: "local-speech",
      pythonRuntimeRequiredForLocalModels: python.source !== "bundled_resource",
      modelBundleRequiredForOfflineKws: !sherpaKws.available,
      cloudSpeechUnaffected: true
    }
  };
}

export function createLocalSpeechProcessEnv({
  env = process.env,
  processResourcesPath = process.resourcesPath,
  cwd = process.cwd()
} = {}) {
  const runtime = resolveLocalSpeechRuntime({ env, processResourcesPath, cwd });
  const next = {
    ...env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8"
  };
  if (!cleanPath(next.UCA_LOCAL_WHISPER_MODEL) && runtime.localWhisper.modelBundled) {
    next.UCA_LOCAL_WHISPER_MODEL = runtime.localWhisper.model;
  }
  if (!cleanPath(next.UCA_SHERPA_KWS_MODEL_DIR) && runtime.sherpaKws.modelAvailable) {
    next.UCA_SHERPA_KWS_MODEL_DIR = runtime.sherpaKws.modelDir;
  }
  return next;
}

export function summarizeLocalSpeechRuntime(runtime = resolveLocalSpeechRuntime()) {
  return {
    schemaVersion: runtime.schemaVersion,
    python: {
      source: runtime.python.source,
      available: resolveCommandAvailability(runtime.python.command, runtime.python.source)
    },
    localWhisper: {
      engine: runtime.localWhisper.engine,
      scriptAvailable: runtime.localWhisper.entrypointAvailable,
      model: runtime.localWhisper.model,
      modelSource: runtime.localWhisper.modelSource,
      modelAvailable: runtime.localWhisper.modelAvailable,
      ready: runtime.localWhisper.ready
    },
    sherpaKws: {
      engine: runtime.sherpaKws.engine,
      scriptAvailable: runtime.sherpaKws.entrypointAvailable,
      modelDir: runtime.sherpaKws.modelDir,
      modelSource: runtime.sherpaKws.modelSource,
      modelAvailable: runtime.sherpaKws.modelAvailable,
      ready: runtime.sherpaKws.ready
    },
    install: runtime.install
  };
}
