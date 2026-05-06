/**
 * Service-side user location.
 *
 * The service does NOT infer city from timezone (that's a guess masquerading
 * as a fact). Real location only shows up here when the browser extension
 * — after the user clicks "📍 启用精确定位" and Chrome grants the prompt —
 * posts it in via /location/update or attaches it on a capture payload.
 *
 * State:
 *   - `_userLocation` is a process-local cache. It rehydrates from
 *     runtime.configStore on service start (see setUserLocation callers)
 *     and is updated whenever the browser reports a fresh fix.
 *   - `getSystemTimezone()` / `formatLocationLabel()` / `locationMatches()`
 *     are pure helpers kept here so the scheduler and agent-loop can use
 *     a single import path.
 *
 * Intentionally NO timezone-to-city table: a user in Shanghai running with
 * their laptop still set to Asia/Tokyo would be silently mislabeled. If we
 * don't have a real location, we say "unknown" — the agent handles that
 * honestly ("where am I?" → "I don't know, try enabling location in the
 * sidepanel").
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

let _userLocation = null;     // normalized record or null
let _userLocationAt = 0;       // ms epoch when we last received a fix

export function getSystemTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Normalize an incoming location payload from the browser. Drops unknown
 * fields so callers can't smuggle arbitrary keys into the agent prompt,
 * and validates types. Returns null if the payload isn't a usable fix.
 */
function normalize(input) {
  if (!input || typeof input !== "object") return null;
  const latitude = typeof input.latitude === "number" ? input.latitude : null;
  const longitude = typeof input.longitude === "number" ? input.longitude : null;
  const city = typeof input.city === "string" && input.city ? input.city : null;
  const country = typeof input.country === "string" && input.country ? input.country : null;
  const countryCode = typeof input.countryCode === "string" && input.countryCode
    ? input.countryCode.toUpperCase() : null;
  const principalSubdivision = typeof input.principalSubdivision === "string"
    ? input.principalSubdivision : null;
  const timezone = typeof input.timezone === "string" && input.timezone
    ? input.timezone : getSystemTimezone();
  const accuracyMeters = typeof input.accuracyMeters === "number" ? input.accuracyMeters : null;
  const source = typeof input.source === "string" ? input.source : "browser";

  // Minimum bar: either we have coords, or at least a city. Pure timezone-
  // only payloads are rejected so we never backslide into the old
  // "timezone pretends to be location" behaviour.
  if (latitude === null && longitude === null && !city && !country) {
    return null;
  }

  return {
    latitude, longitude, city, principalSubdivision, country, countryCode,
    timezone, accuracyMeters, source,
    fetchedAt: typeof input.fetchedAt === "string" ? input.fetchedAt : new Date().toISOString()
  };
}

/**
 * Store a new user-location fix coming from the browser (or anywhere else).
 * Returns the stored record, or null if the input was rejected.
 */
export function setUserLocation(input) {
  const record = normalize(input);
  if (!record) return null;
  _userLocation = record;
  _userLocationAt = Date.now();
  return record;
}

export function hydrateUserLocation(input) {
  const record = normalize(input);
  if (!record) return null;
  const parsed = Date.parse(record.fetchedAt);
  _userLocation = record;
  _userLocationAt = Number.isFinite(parsed) ? parsed : Date.now();
  return record;
}

export function serializeUserLocation() {
  return _userLocation ? { ..._userLocation } : null;
}

/**
 * Synchronous read used by the agent-loop prompt builder and the scheduler
 * dispatch gate. Returns null if nothing has been set, or if the stored
 * fix is older than `maxAgeMs` (default 24h). Callers decide how to
 * degrade: the agent-loop simply omits the location line when this is
 * null, which is the correct honest behaviour.
 */
export function getUserLocation({ maxAgeMs = DEFAULT_TTL_MS } = {}) {
  if (!_userLocation) return null;
  if (Date.now() - _userLocationAt > maxAgeMs) return null;
  return _userLocation;
}

export function clearUserLocation() {
  _userLocation = null;
  _userLocationAt = 0;
}

export function formatLocationLabel(location) {
  if (!location) return "unknown (location not granted)";
  const parts = [];
  if (location.city) parts.push(location.city);
  if (location.principalSubdivision && location.principalSubdivision !== location.city) {
    parts.push(location.principalSubdivision);
  }
  if (location.country) parts.push(location.country);
  const head = parts.length > 0
    ? parts.join(", ")
    : (location.latitude !== null && location.longitude !== null
        ? `${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}`
        : location.timezone ?? "unknown");
  const acc = typeof location.accuracyMeters === "number"
    ? `, ±${Math.round(location.accuracyMeters)}m` : "";
  return `${head} (${location.timezone ?? ""}${acc})`;
}

/**
 * Match a location against an optional coarse filter. Unknown fields match.
 * A null location never matches a non-empty filter — if the user hasn't
 * granted location, location-gated triggers stay blocked until they do.
 */
export function locationMatches(location, filter) {
  if (!filter || typeof filter !== "object" || Object.keys(filter).length === 0) return true;
  if (!location) return false;
  const eq = (a, b) =>
    typeof a === "string" && typeof b === "string" &&
    a.trim().toLowerCase() === b.trim().toLowerCase();
  if (filter.countryCode && !eq(location.countryCode, filter.countryCode)) return false;
  if (filter.country     && !eq(location.country, filter.country))         return false;
  if (filter.city        && !eq(location.city, filter.city))               return false;
  if (filter.principalSubdivision
      && !eq(location.principalSubdivision, filter.principalSubdivision))  return false;
  return true;
}
