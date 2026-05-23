export function buildExplorerSelectionEnvelope({
  source = "hotkey",
  hwnd = null,
  filePaths = [],
  capturedAt = new Date().toISOString()
} = {}) {
  return {
    schema_version: "1.0",
    source,
    hwnd,
    file_paths: filePaths,
    captured_at: capturedAt
  };
}

export function buildExplorerPromptHandoff({
  filePaths = [],
  sourceApp = "explorer.exe",
  captureMode = "shell_menu",
  capturedAt = new Date().toISOString()
} = {}) {
  return {
    schema_version: "1.0",
    source_app: sourceApp,
    capture_mode: captureMode,
    file_paths: filePaths,
    captured_at: capturedAt
  };
}
