/**
 * Desktop-side geolocator for Windows.
 *
 * Shells out to PowerShell to query System.Device.Location.GeoCoordinateWatcher
 * — the same Windows Location Service that Maps and Weather use. Returns
 * lat/lng when the user has granted access in Windows Settings, otherwise
 * a structured error so the desktop console can guide them to the right
 * settings page (`ms-settings:privacy-location`).
 *
 * Important: there's NO per-app permission prompt for unpackaged Node
 * processes. The two switches that control this live in:
 *   Settings → Privacy & security → Location → "Location services"
 *   Settings → Privacy & security → Location → "Let desktop apps access your location"
 * If either is OFF, GeoCoordinateWatcher.Permission returns `Denied` and we
 * surface that as `reason: "denied"`. The desktop UI then offers a button
 * that opens those settings via the ms-settings: URI scheme.
 */

import { spawn } from "node:child_process";
import { setUserLocation } from "./location.mjs";

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Device
  $watcher = New-Object System.Device.Location.GeoCoordinateWatcher
  $null = $watcher.TryStart($false, [TimeSpan]::FromSeconds(8))
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  while ([DateTime]::UtcNow -lt $deadline -and $watcher.Status -ne 'Ready' -and $watcher.Permission -ne 'Denied') {
    Start-Sleep -Milliseconds 200
  }
  if ($watcher.Permission -eq 'Denied') {
    @{ status = 'denied' } | ConvertTo-Json -Compress
  } elseif ($watcher.Position.Location.IsUnknown) {
    @{ status = 'unavailable' } | ConvertTo-Json -Compress
  } else {
    $loc = $watcher.Position.Location
    @{
      status = 'ok'
      latitude = [double]$loc.Latitude
      longitude = [double]$loc.Longitude
      accuracy = [double]$loc.HorizontalAccuracy
    } | ConvertTo-Json -Compress
  }
  $watcher.Stop()
} catch {
  @{ status = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress
}
`.trim();

/**
 * Spawn powershell, capture stdout/stderr, and parse the single JSON line
 * the script emits. We run with -NoProfile and -NonInteractive so the user's
 * PS profile (which can take a second or print noise) doesn't pollute the
 * output. Hard-cap at 12s — Windows location can hang if the location
 * provider is slow to start.
 */
function runPowerShell(script, { timeoutMs = 12_000 } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    const watchdog = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish({ status: "timeout" });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(watchdog);
      finish({ status: "spawn_error", message: err.message });
    });

    child.on("close", () => {
      clearTimeout(watchdog);
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) {
        finish({ status: "no_output", stderr: stderr.trim() || null });
        return;
      }
      try {
        finish(JSON.parse(line));
      } catch {
        finish({ status: "parse_error", raw: line, stderr: stderr.trim() || null });
      }
    });
  });
}

async function reverseGeocode(latitude, longitude) {
  // BigDataCloud's free, key-less reverse-geocoding endpoint. Same one the
  // browser side uses, so the agent sees the same address shape regardless
  // of which device's geolocator produced the fix. If the network call
  // fails we still return lat/lng — the agent can work with that.
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
 * Public API: try to get a fresh fix from Windows. On success, store it via
 * setUserLocation() and return the stored record. On failure, return a
 * structured `{ ok: false, reason }` so the caller can render the right
 * remediation tip.
 *
 * Possible reasons:
 *   - "unsupported_platform"  → not Windows
 *   - "denied"                → Windows Location Service or desktop-app access is OFF
 *   - "unavailable"           → service is on but no fix yet (no GPS, no Wi-Fi positioning)
 *   - "timeout"               → PowerShell took too long
 *   - "spawn_error" | "parse_error" | "no_output" | "error" → infrastructure
 */
export async function refreshWindowsLocation({ timeoutMs = 12_000 } = {}) {
  if (process.platform !== "win32") {
    return { ok: false, reason: "unsupported_platform" };
  }
  const result = await runPowerShell(PS_SCRIPT, { timeoutMs });
  if (result.status !== "ok") {
    return { ok: false, reason: result.status, detail: result };
  }
  const geo = await reverseGeocode(result.latitude, result.longitude);
  const record = setUserLocation({
    latitude: result.latitude,
    longitude: result.longitude,
    accuracyMeters: typeof result.accuracy === "number" ? result.accuracy : null,
    city: geo?.city ?? null,
    principalSubdivision: geo?.principalSubdivision ?? null,
    country: geo?.country ?? null,
    countryCode: geo?.countryCode ?? null,
    source: geo
      ? "windows.geocoordinatewatcher+bigdatacloud"
      : "windows.geocoordinatewatcher",
    fetchedAt: new Date().toISOString()
  });
  if (!record) {
    return { ok: false, reason: "rejected_by_normalizer" };
  }
  return { ok: true, location: record };
}
