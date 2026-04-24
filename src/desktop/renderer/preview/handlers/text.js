// Text handler (UCA-182 Phase 3).
//
// Reads the file via the preload's readTextFile IPC and drops the
// contents into a styled <pre>. Handles .txt / .log / .json /
// .jsonl and the usual programming-language extensions.
//
// Priority is set above the iframe-remote handler so code / log /
// json files render locally (faster, no HTTP roundtrip) even though
// the server could also handle them.

(function initTextHandler() {
  if (!window.livePreviewClient) return;

  const TEXT_EXT = new Set([
    ".txt", ".log", ".json", ".jsonl", ".ndjson",
    ".js", ".mjs", ".cjs", ".jsx",
    ".ts", ".tsx",
    ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".c", ".cc", ".cpp", ".h", ".hpp",
    ".sh", ".bash", ".ps1", ".bat", ".cmd",
    ".sql", ".yaml", ".yml", ".toml", ".ini", ".conf", ".env",
    ".xml", ".css", ".scss", ".less"
  ]);

  const { escapeHtml } = window.livePreviewClient._helpers;

  window.livePreviewClient.register({
    id: "client-text",
    extensions: [...TEXT_EXT],
    priority: 20,
    async render(container, { filePath }) {
      if (!window.ucaShell?.readTextFile) {
        throw new Error("ucaShell.readTextFile 未挂载（preload）");
      }
      const raw = await window.ucaShell.readTextFile(filePath, 512 * 1024);
      container.innerHTML = `<pre class="lp-pre"></pre>`;
      container.querySelector("pre").textContent = raw ?? "";
    }
  });
})();
