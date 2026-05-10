export const ECHO_DOCK_DROP_VOICE_READY_MS = 30_000;

export function buildOverlayPayloadFromFiles(filePaths, sourceApp = "uca.dock", captureMode = "dock_drop", options = {}) {
  return {
    source_app: sourceApp,
    capture_mode: captureMode,
    file_paths: filePaths,
    targetWindow: "overlay",
    mode: options.mode ?? null,
    surface: options.surface ?? null,
    voiceContinueTtlMs: options.voiceContinueTtlMs ?? 0
  };
}
