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
