/**
 * auto-updater.mjs — P0-1 (v1.0 release blocker)
 *
 * electron-updater integration. The update channel is GitHub Releases
 * (lingxy-ai/lingxy-desktop, configured in package.json build.publish).
 *
 * ## Strategy ladder (4 tiers, codex round-1 design)
 *
 *   off    : never check, never download, never install.
 *   manual : only check when the user explicitly invokes "Check now".
 *   notify : check in the background; when an update is found, notify
 *            the user, but do NOT auto-download. User must opt in.
 *   auto   : check + download automatically. quitAndInstall() is still
 *            triggered ONLY by user action (popup card / Settings),
 *            never silently on app quit.
 *
 * autoDownload and autoInstallOnAppQuit are explicitly forced to false
 * regardless of strategy — codex flagged Electron's defaults (both
 * true) as the source of "I thought it was just notifying but it
 * downloaded on its own" UX bugs. The wrapper is the single owner of
 * the "should download / should install" decision.
 *
 * ## Privacy posture
 *
 * Hitting GitHub Releases exposes IP/User-Agent to GitHub. README and
 * the Console update control and first-click toast disclose this. There is NO
 * LingxY-hosted telemetry — `nothing routes through a LingxY-hosted
 * server` (per README). We do not add custom telemetry headers.
 *
 * ## User-initiated checks
 *
 * On a fresh install the effective strategy is `off`, so launch never
 * calls GitHub Releases or interrupts the user with a consent popup.
 * The Console update button is the explicit user action that records
 * `manual` and runs "Check now". Background `notify` / `auto` checks
 * can only happen after the user has already stored that preference.
 *
 * ## Failure handling
 *
 * Every event handler is fail-soft: errors go to
 * appendDesktopDiagnosticError (local log) and never bubble to the
 * UI. A failed update does NOT degrade the running app session.
 */

export const UPDATE_STRATEGIES = Object.freeze(["off", "manual", "notify", "auto"]);
export const DEFAULT_UPDATE_STRATEGY = "off";

/**
 * Create the auto-updater controller.
 *
 * Dependency-injected to mirror the rest of the runtime's test style
 * — behavior tests stub `autoUpdater` with a fake EventEmitter and
 * assert event sequences without spawning Electron.
 *
 * @param {object} args
 * @param {object} args.autoUpdater       electron-updater autoUpdater instance.
 * @param {function} args.getStrategy      () => "off" | "manual" | "notify" | "auto"
 *                                         Reads the user's recorded preference.
 *                                         Called on every check and on each event handler so
 *                                         strategy changes from Settings UI take effect
 *                                         without restart.
 * @param {function} [args.notify]         async ({ kind, payload }) => void
 *                                         Sends user-facing notifications. Caller is responsible
 *                                         for routing to brand popup card / system notification /
 *                                         dock badge etc. `kind` is one of:
 *                                           "update-available", "update-ready", "update-error".
 * @param {function} [args.appendDiagnostic] (event, error, ctx) => void
 *                                         Local diagnostic sink; errors written here, never
 *                                         shown in UI.
 * @param {function} [args.logger]         { info?, warn?, error? } structured logger.
 */
export function createAutoUpdater({
  autoUpdater,
  getStrategy,
  notify = async () => {},
  appendDiagnostic = () => {},
  logger = {}
} = {}) {
  if (!autoUpdater) {
    throw new Error("createAutoUpdater requires `autoUpdater` injection");
  }
  if (typeof getStrategy !== "function") {
    throw new Error("createAutoUpdater requires `getStrategy` injection — strategy must be explicit, never hardcoded");
  }

  // Force-off Electron's silent-action defaults. The wrapper is the
  // sole owner of when downloads happen; strategy === "auto" decides
  // download via an explicit downloadUpdate() call below, not via
  // autoUpdater.autoDownload sneaking up at check time.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  let available = null;           // last UpdateInfo reported by update-available
  let downloaded = null;          // last UpdateInfo that completed download
  let downloading = false;        // current in-flight download flag
  let lastCheckedAt = null;       // ISO timestamp
  let lastCheckResult = null;     // "available" | "none" | "error" | null
  let lastCheckTrigger = null;    // "scheduled" | "user" | ...
  let pendingCheck = null;        // current in-flight check promise

  function safe(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        appendDiagnostic("auto_updater_event_failure", error, { args });
        logger.warn?.("[auto-updater] event handler failed:", error?.message ?? error);
      }
    };
  }

  async function downloadAvailableUpdate(info, { notifyDownloading = false } = {}) {
    const updateInfo = info ?? available;
    if (!updateInfo) {
      throw new Error("downloadUpdate: no update is available yet");
    }
    if (downloading) return { skipped: "download_in_progress" };
    downloading = true;
    try {
      if (notifyDownloading) {
        await notify({ kind: "update-available", payload: { info: updateInfo, autoDownload: true } });
      }
      const result = await autoUpdater.downloadUpdate();
      return { ok: true, result };
    } catch (error) {
      appendDiagnostic("auto_updater_download_failed", error, { info: updateInfo });
      await notify({ kind: "update-error", payload: { phase: "download", message: error?.message } });
      return { ok: false, error: error?.message ?? String(error) };
    } finally {
      downloading = false;
    }
  }

  autoUpdater.on?.("update-available", safe(async (info) => {
    available = info;
    downloaded = null;
    lastCheckResult = "available";
    const strategy = getStrategy();
    if (strategy === "off") {
      // Strategy demoted between check and event — nothing to do.
      return;
    }
    if (strategy === "manual") {
      if (lastCheckTrigger === "user") {
        await notify({ kind: "update-available", payload: { info, autoDownload: false } });
      }
      return;
    }
    if (strategy === "notify") {
      await notify({ kind: "update-available", payload: { info, autoDownload: false } });
      return;
    }
    if (strategy === "auto") {
      await notify({ kind: "update-available", payload: { info, autoDownload: true } });
      // Trigger download; the "update-downloaded" event will fire when complete.
      await downloadAvailableUpdate(info, { notifyDownloading: false });
    }
  }));

  autoUpdater.on?.("update-not-available", safe(async (info) => {
    available = null;
    lastCheckResult = "none";
    logger.info?.("[auto-updater] no update available", info?.version);
  }));

  autoUpdater.on?.("update-downloaded", safe(async (info) => {
    available = null;
    downloaded = info;
    downloading = false;
    await notify({ kind: "update-ready", payload: { info } });
  }));

  autoUpdater.on?.("error", safe(async (error) => {
    downloading = false;
    lastCheckResult = "error";
    appendDiagnostic("auto_updater_runtime_error", error, {});
    await notify({ kind: "update-error", payload: { phase: "runtime", message: error?.message } });
  }));

  /**
   * Run a check. Honors the current strategy:
   *   off     : no-op
   *   manual  : runs only when `trigger === "user"` (Check Now button)
   *   notify  : runs on schedule and on user demand
   *   auto    : same; download is automatic via update-available handler
   */
  async function checkForUpdates({ trigger = "scheduled" } = {}) {
    const strategy = getStrategy();
    if (strategy === "off") return { skipped: "off" };
    if (strategy === "manual" && trigger !== "user") return { skipped: "manual_skips_scheduled" };

    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
      lastCheckedAt = new Date().toISOString();
      lastCheckTrigger = trigger;
      try {
        const result = await autoUpdater.checkForUpdates();
        return { ok: true, result };
      } catch (error) {
        lastCheckResult = "error";
        appendDiagnostic("auto_updater_check_failed", error, { trigger });
        await notify({ kind: "update-error", payload: { phase: "check", message: error?.message } });
        return { ok: false, error: error?.message ?? String(error) };
      } finally {
        pendingCheck = null;
      }
    })();
    return pendingCheck;
  }

  /**
   * User explicitly chose "install now". Triggers Electron's
   * quitAndInstall — process exits and the new version launches.
   * Caller is responsible for asking for confirmation; this method
   * does not re-prompt.
   */
  function applyUpdate({ silent = false, restart = true } = {}) {
    if (!downloaded) {
      throw new Error("applyUpdate: no update has been downloaded yet");
    }
    autoUpdater.quitAndInstall(silent, restart);
  }

  function getStatus() {
    return {
      strategy: getStrategy(),
      lastCheckedAt,
      lastCheckResult,
      available: available ? { version: available.version, releaseDate: available.releaseDate ?? null } : null,
      downloaded: downloaded ? { version: downloaded.version, releaseDate: downloaded.releaseDate ?? null } : null,
      downloading,
      pending: Boolean(pendingCheck)
    };
  }

  return {
    checkForUpdates,
    downloadUpdate: () => downloadAvailableUpdate(null, { notifyDownloading: true }),
    applyUpdate,
    getStatus,
    UPDATE_STRATEGIES
  };
}
