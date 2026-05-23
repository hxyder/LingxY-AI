// Global drop guard (UCA-182 Phase 7).
//
// Electron's default behaviour for a drop event that no listener has
// preventDefault'd is to let the webContents open the file — which on
// Windows often shows a "save as" dialog (especially for Office
// formats). Historically only certain regions (voiceCard in overlay)
// call preventDefault, so dropping a pptx onto the composer or a
// bubble-area triggers the native save prompt.
//
// Fix: install a window-level dragover + drop guard that always
// preventDefault's any drag carrying File payloads. Region handlers
// that want to do something with dropped files still work — they run
// before the window handler if they call stopPropagation (which the
// voiceCard listener already does).
//
// This script is loaded as a plain <script> tag in console.html and
// overlay.html **before** any other UI script, so it wins the event
// ordering race even if later scripts try to register their own
// handlers lazily after DOMContentLoaded.

(function installDropGuard() {
  function hasFilePayload(event) {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    // DataTransferItemList doesn't implement Array methods universally;
    // iterate both shapes.
    for (let i = 0; i < types.length; i += 1) {
      if (types[i] === "Files") return true;
    }
    return false;
  }

  function onDragOver(event) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event) {
    if (!hasFilePayload(event)) return;
    // Region handlers (e.g. voiceCard) that want to consume the drop
    // must stopPropagation so the event never reaches here. If it did
    // reach here, the drop is on an unregistered region and we simply
    // swallow it — preventing Electron's default "open file" behaviour
    // that would otherwise pop a save dialog.
    event.preventDefault();
  }

  window.addEventListener("dragover", onDragOver, false);
  window.addEventListener("drop", onDrop, false);
})();
