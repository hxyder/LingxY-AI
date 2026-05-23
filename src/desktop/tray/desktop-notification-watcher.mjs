import path from "node:path";
import { mkdir, readdir, readFile, unlink, watch } from "node:fs/promises";

export function createDesktopNotificationWatcher({
  notificationDir,
  notificationFilePattern,
  showDesktopNotification,
  safeError
} = {}) {
  if (!notificationDir) throw new TypeError("createDesktopNotificationWatcher requires notificationDir.");
  if (!(notificationFilePattern instanceof RegExp)) {
    throw new TypeError("createDesktopNotificationWatcher requires notificationFilePattern.");
  }
  if (typeof showDesktopNotification !== "function") {
    throw new TypeError("createDesktopNotificationWatcher requires showDesktopNotification.");
  }

  const processedNotificationFiles = new Set();
  let notificationWatcher = null;
  let stopping = false;

  async function consumeNotificationFile(notificationFile) {
    if (!notificationFilePattern.test(path.basename(notificationFile))) {
      return false;
    }
    if (processedNotificationFiles.has(notificationFile)) {
      return false;
    }

    processedNotificationFiles.add(notificationFile);
    try {
      const raw = await readFile(notificationFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      await unlink(notificationFile).catch(() => {});
      showDesktopNotification(payload);
      return true;
    } finally {
      processedNotificationFiles.delete(notificationFile);
    }
  }

  async function drainNotificationDirectory() {
    try {
      await mkdir(notificationDir, { recursive: true });
      const entries = await readdir(notificationDir, { withFileTypes: true });
      const notificationFiles = entries
        .filter((entry) => entry.isFile() && notificationFilePattern.test(entry.name))
        .map((entry) => path.join(notificationDir, entry.name))
        .sort((left, right) => left.localeCompare(right));

      for (const notificationFile of notificationFiles) {
        await consumeNotificationFile(notificationFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError?.("Failed to drain notification directory", error);
      }
    }
  }

  async function startNotificationWatcher() {
    stopping = false;
    await drainNotificationDirectory();

    try {
      await mkdir(notificationDir, { recursive: true });
      notificationWatcher = watch(notificationDir);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError?.("Failed to watch notification directory", error);
      }
      return;
    }

    (async () => {
      try {
        for await (const event of notificationWatcher) {
          if (!event.filename || !notificationFilePattern.test(event.filename)) {
            continue;
          }
          await consumeNotificationFile(path.join(notificationDir, event.filename));
        }
      } catch (error) {
        if (!stopping && error?.name !== "AbortError") {
          safeError?.("Notification watcher stopped unexpectedly", error);
        }
      }
    })().catch((error) => {
      safeError?.("Notification watcher task failed", error);
    });
  }

  function stopNotificationWatcher() {
    stopping = true;
    notificationWatcher?.return?.().catch?.(() => {});
  }

  return {
    consumeNotificationFile,
    drainNotificationDirectory,
    startNotificationWatcher,
    stopNotificationWatcher
  };
}
