import path from "node:path";
import { readdir, readFile, unlink, watch } from "node:fs/promises";

export function createExplorerHandoffWatcher({
  handoffDir,
  handoffFilePattern,
  showWindow,
  enqueueWindowMessage,
  shellContextReceivedChannel,
  safeError
} = {}) {
  if (!handoffDir) throw new TypeError("createExplorerHandoffWatcher requires handoffDir.");
  if (!(handoffFilePattern instanceof RegExp)) {
    throw new TypeError("createExplorerHandoffWatcher requires handoffFilePattern.");
  }
  if (typeof showWindow !== "function") throw new TypeError("createExplorerHandoffWatcher requires showWindow.");
  if (typeof enqueueWindowMessage !== "function") {
    throw new TypeError("createExplorerHandoffWatcher requires enqueueWindowMessage.");
  }

  const processedHandoffFiles = new Set();
  let handoffWatcher = null;
  let stopping = false;

  async function consumeHandoffFile(handoffFile) {
    if (!handoffFilePattern.test(path.basename(handoffFile))) {
      return false;
    }
    if (processedHandoffFiles.has(handoffFile)) {
      return false;
    }

    processedHandoffFiles.add(handoffFile);
    try {
      const raw = await readFile(handoffFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      await unlink(handoffFile).catch(() => {});
      showWindow("overlay");
      enqueueWindowMessage("overlay", shellContextReceivedChannel, {
        ...payload,
        targetWindow: "overlay"
      });
      return true;
    } finally {
      processedHandoffFiles.delete(handoffFile);
    }
  }

  async function drainHandoffDirectory() {
    try {
      const entries = await readdir(handoffDir, { withFileTypes: true });
      const handoffFiles = entries
        .filter((entry) => entry.isFile() && handoffFilePattern.test(entry.name))
        .map((entry) => path.join(handoffDir, entry.name))
        .sort((left, right) => left.localeCompare(right));

      for (const handoffFile of handoffFiles) {
        await consumeHandoffFile(handoffFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError?.("Failed to drain explorer handoff directory", error);
      }
    }
  }

  async function startHandoffWatcher() {
    stopping = false;
    await drainHandoffDirectory();

    try {
      handoffWatcher = watch(handoffDir);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError?.("Failed to watch explorer handoff directory", error);
      }
      return;
    }

    (async () => {
      try {
        for await (const event of handoffWatcher) {
          if (!event.filename || !handoffFilePattern.test(event.filename)) {
            continue;
          }
          await consumeHandoffFile(path.join(handoffDir, event.filename));
        }
      } catch (error) {
        if (!stopping && error?.name !== "AbortError") {
          safeError?.("Explorer handoff watcher stopped unexpectedly", error);
        }
      }
    })().catch((error) => {
      safeError?.("Explorer handoff watcher task failed", error);
    });
  }

  function stopHandoffWatcher() {
    stopping = true;
    handoffWatcher?.return?.().catch?.(() => {});
  }

  return {
    consumeHandoffFile,
    drainHandoffDirectory,
    startHandoffWatcher,
    stopHandoffWatcher
  };
}
