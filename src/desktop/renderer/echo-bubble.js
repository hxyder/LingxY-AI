// Echo bubble HUD — listens for "uca:echo-bubble-show" IPC pushes from main
// and delegates to window.__echoBubbleApi.show. Kept deliberately thin so
// the show/hide animation logic stays colocated with the CSS in the HTML.
window.echoBubbleShellClient?.onEchoBubble?.((payload) => {
  window.__echoBubbleApi?.show?.(payload ?? {});
});
