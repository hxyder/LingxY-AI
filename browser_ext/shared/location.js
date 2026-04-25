/**
 * Browser-extension location module — REAL geolocation, with user consent.
 *
 * `geolocation` is declared as an OPTIONAL permission in the manifest, so:
 *   1. First click on the chip → chrome.permissions.request(['geolocation'])
 *      → Chrome shows the native "do you allow this extension to access your
 *      location?" prompt. Without this dance, declaring geolocation in the
 *      regular `permissions` array silently grants it at install — no prompt
 *      ever fires, which is exactly the UX the user reported as broken.
 *   2. After approval we call navigator.geolocation.getCurrentPosition and
 *      reverse-geocode lat/lng via BigDataCloud's free, CORS-enabled,
 *      key-less client endpoint.
 *   3. Result cached in chrome.storage.local under STORAGE_KEY, with a
 *      fetched-at timestamp. Service worker mirrors it for outbound capture
 *      payloads (service workers can't call navigator.geolocation directly).
 *   4. Clearing fully revokes: removes our cache AND calls
 *      chrome.permissions.remove(['geolocation']) so the next request prompts
 *      again. Otherwise Chrome silently re-grants and the user's "no" feels
 *      ignored.
 */

export const STORAGE_KEY = "ucaUserLocation";
export const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

function hasChromePermissions() {
  return typeof chrome !== "undefined" && chrome.permissions?.request;
}

/**
 * Check (and request, if missing) the optional geolocation permission.
 * MUST be called from a user-gesture handler — Chrome rejects
 * permissions.request() outside one. Returns { ok, granted } so callers can
 * distinguish "user said no" from "we couldn't even ask".
 */
export async function ensureGeolocationPermission() {
  if (!hasChromePermissions()) return { ok: false, granted: false, reason: "no_permissions_api" };
  const already = await new Promise((resolve) => {
    chrome.permissions.contains({ permissions: ["geolocation"] }, resolve);
  });
  if (already) return { ok: true, granted: true, alreadyGranted: true };
  const granted = await new Promise((resolve) => {
    try {
      chrome.permissions.request({ permissions: ["geolocation"] }, (ok) => resolve(Boolean(ok)));
    } catch {
      resolve(false);
    }
  });
  return granted
    ? { ok: true, granted: true, alreadyGranted: false }
    : { ok: false, granted: false, reason: "permission_denied" };
}

/** Revoke our optional geolocation permission so the next attempt prompts again. */
export async function revokeGeolocationPermission() {
  if (!hasChromePermissions()) return false;
  return new Promise((resolve) => {
    try {
      chrome.permissions.remove({ permissions: ["geolocation"] }, (ok) => resolve(Boolean(ok)));
    } catch {
      resolve(false);
    }
  });
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
 * Trigger the geolocation permission prompt (if not yet granted), then read
 * the position, reverse-geocode, and cache. MUST be called from a user
 * gesture (button click) — both chrome.permissions.request() and the
 * permission prompt require active user activation.
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
 * Full revoke: wipe our cache AND remove the optional Chrome permission
 * so the next requestPreciseLocation() shows the prompt again. Without
 * the permission removal, "clear" only wipes our storage but Chrome still
 * remembers the grant — the user perceives that as the cancel being
 * ignored (which is exactly the bug reported on first attempt).
 */
export async function clearCachedLocation() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try { await chrome.storage.local.remove(STORAGE_KEY); } catch { /* best effort */ }
  }
  await revokeGeolocationPermission();
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
