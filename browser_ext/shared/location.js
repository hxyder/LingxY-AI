/**
 * Browser-extension location module — REAL geolocation, with user consent.
 *
 * Chrome MV3 requires `geolocation` in the manifest's required permissions,
 * but does not allow it in optional_permissions. The side-panel click calls
 * navigator.geolocation directly from the user gesture; the browser owns the
 * native permission prompt. We only cache the approved result in
 * chrome.storage.local and mirror it to the service worker/desktop.
 */

export const STORAGE_KEY = "ucaUserLocation";
export const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

/**
 * Geolocation permission is requested by navigator.geolocation itself. This
 * helper only keeps the old call boundary stable and checks whether the Web
 * API is available in the current extension page.
 */
export async function ensureGeolocationPermission() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, granted: false, reason: "unsupported" };
  }
  return { ok: true, granted: true, alreadyGranted: false };
}

/** Chrome does not expose a geolocation optional permission to revoke here. */
export async function revokeGeolocationPermission() {
  return false;
}

export function getSystemTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

async function reverseGeocode(latitude, longitude) {
  // BigDataCloud's free client-side reverse-geocoding endpoint: no API key,
  // CORS-enabled, city/country resolution. If it fails (offline / rate
  // limit) we still return lat/lng without a name, which the agent can use
  // directly.
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const j = await res.json();
    return {
      city: j.city || j.locality || j.principalSubdivision || null,
      principalSubdivision: j.principalSubdivision || null,
      country: j.countryName || null,
      countryCode: (j.countryCode || "").toUpperCase() || null
    };
  } catch {
    return null;
  }
}

/**
 * Wrap navigator.geolocation.getCurrentPosition in a promise. Times out
 * because the browser will hang indefinitely if the user ignores the prompt.
 */
function getCurrentPosition({ timeoutMs = 15000, highAccuracy = false } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const watchdog = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs + 2000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(watchdog);
        finish({
          ok: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        clearTimeout(watchdog);
        const codeToReason = {
          1: "permission_denied",
          2: "position_unavailable",
          3: "timeout"
        };
        finish({
          ok: false,
          reason: codeToReason[error.code] ?? "error",
          message: error.message
        });
      },
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

/**
 * Read the cached location from chrome.storage.local. Returns null if none
 * is stored or if the cache is older than maxAgeMs.
 */
export async function getCachedLocation({ maxAgeMs = MAX_CACHE_AGE_MS } = {}) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const record = data?.[STORAGE_KEY];
    if (!record || !record.fetchedAt) return null;
    const age = Date.now() - new Date(record.fetchedAt).getTime();
    if (age > maxAgeMs) return null;
    return record;
  } catch {
    return null;
  }
}

async function writeCachedLocation(record) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: record });
  } catch {
    /* best effort */
  }
}

/**
 * Trigger the browser geolocation prompt (if not yet granted), then read the
 * position, reverse-geocode, and cache. MUST be called from a user gesture
 * (button click) so Chrome can show the native prompt.
 */
export async function requestPreciseLocation({ highAccuracy = false } = {}) {
  const perm = await ensureGeolocationPermission();
  if (!perm.granted) {
    return { ok: false, reason: perm.reason ?? "permission_denied" };
  }
  const pos = await getCurrentPosition({ highAccuracy });
  if (!pos.ok) {
    return { ok: false, reason: pos.reason, message: pos.message };
  }
  const geo = await reverseGeocode(pos.latitude, pos.longitude);
  const record = {
    timezone: getSystemTimezone(),
    city: geo?.city ?? null,
    principalSubdivision: geo?.principalSubdivision ?? null,
    country: geo?.country ?? null,
    countryCode: geo?.countryCode ?? null,
    latitude: pos.latitude,
    longitude: pos.longitude,
    accuracyMeters: pos.accuracy ?? null,
    source: geo ? "navigator.geolocation+bigdatacloud" : "navigator.geolocation",
    fetchedAt: new Date().toISOString()
  };
  await writeCachedLocation(record);
  return { ok: true, location: record, alreadyGranted: perm.alreadyGranted === true };
}

/**
 * Clear our cached location. Browser-level geolocation grants/denials remain
 * under Chrome's site/extension permission UI because `geolocation` is a
 * required extension permission, not a valid optional permission.
 */
export async function clearCachedLocation() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try { await chrome.storage.local.remove(STORAGE_KEY); } catch { /* best effort */ }
  }
}

export function formatLocationLabel(location) {
  if (!location) return "未授权";
  const parts = [];
  if (location.city) parts.push(location.city);
  if (location.country) parts.push(location.country);
  if (parts.length === 0) {
    return `${location.latitude?.toFixed(3)}, ${location.longitude?.toFixed(3)} (${location.timezone ?? ""})`;
  }
  return `${parts.join(", ")} (${location.timezone ?? ""})`;
}
