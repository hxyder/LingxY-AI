import path from "node:path";
import { pathToFileURL } from "node:url";

export function registerPdfIpc({ ipcMain, app }) {
  if (!ipcMain?.handle) throw new TypeError("registerPdfIpc requires ipcMain.");
  if (!app?.getAppPath) throw new TypeError("registerPdfIpc requires app.");

  // UCA-182 Phase 4: resolve pdfjs-dist worker/module URLs for renderer-side PDF preview.
  ipcMain.handle("uca:get-pdf-worker-url", async () => {
    const workerPath = path.join(
      app.getAppPath(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.mjs"
    );
    const mainPath = path.join(
      app.getAppPath(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.mjs"
    );
    return {
      workerUrl: pathToFileURL(workerPath).toString(),
      mainUrl: pathToFileURL(mainPath).toString()
    };
  });
}
