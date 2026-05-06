import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKGROUND_REFRESH_MIN_AGE_MS,
  STORAGE_KEY,
  refreshLocationIfAlreadyGranted
} from "../../browser_ext/shared/location.js";

function installBrowserLocationMocks({
  permissionState = "granted",
  position = {
    latitude: 40.7128,
    longitude: -74.0060,
    accuracy: 22
  },
  initialRecord = null
} = {}) {
  const originalChrome = globalThis.chrome;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  const storage = {};
  if (initialRecord) storage[STORAGE_KEY] = initialRecord;
  let geolocationCalls = 0;

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(patch) {
          Object.assign(storage, patch);
        },
        async remove(key) {
          delete storage[key];
        }
      }
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      permissions: {
        async query() {
          return { state: permissionState };
        }
      },
      geolocation: {
        getCurrentPosition(success) {
          geolocationCalls += 1;
          success({
            coords: {
              latitude: position.latitude,
              longitude: position.longitude,
              accuracy: position.accuracy
            }
          });
        }
      }
    }
  });
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        city: "New York",
        principalSubdivision: "New York",
        countryName: "United States",
        countryCode: "US"
      };
    }
  });

  return {
    storage,
    get geolocationCalls() { return geolocationCalls; },
    restore() {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator
      });
      if (originalFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = originalFetch;
    }
  };
}

test("browser extension silently refreshes stale cached location when permission is already granted", async () => {
  const mock = installBrowserLocationMocks({
    initialRecord: {
      latitude: 35.7796,
      longitude: -78.6382,
      city: "Raleigh",
      country: "United States",
      countryCode: "US",
      timezone: "America/New_York",
      source: "navigator.geolocation",
      fetchedAt: new Date(Date.now() - BACKGROUND_REFRESH_MIN_AGE_MS - 10_000).toISOString()
    }
  });
  try {
    const result = await refreshLocationIfAlreadyGranted();
    assert.equal(result.ok, true);
    assert.equal(result.refreshed, true);
    assert.equal(result.location.city, "New York");
    assert.equal(mock.storage[STORAGE_KEY].city, "New York");
    assert.equal(mock.geolocationCalls, 1);
  } finally {
    mock.restore();
  }
});

test("browser extension does not prompt or refresh when geolocation is not already granted", async () => {
  const cached = {
    latitude: 35.7796,
    longitude: -78.6382,
    city: "Raleigh",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
    source: "navigator.geolocation",
    fetchedAt: new Date(Date.now() - BACKGROUND_REFRESH_MIN_AGE_MS - 10_000).toISOString()
  };
  const mock = installBrowserLocationMocks({
    permissionState: "prompt",
    initialRecord: cached
  });
  try {
    const result = await refreshLocationIfAlreadyGranted();
    assert.equal(result.ok, true);
    assert.equal(result.refreshed, false);
    assert.equal(result.reason, "permission_not_granted");
    assert.equal(result.location.city, "Raleigh");
    assert.equal(mock.geolocationCalls, 0);
  } finally {
    mock.restore();
  }
});

test("browser extension reuses fresh cached location without touching geolocation", async () => {
  const mock = installBrowserLocationMocks({
    initialRecord: {
      latitude: 35.7796,
      longitude: -78.6382,
      city: "Raleigh",
      country: "United States",
      countryCode: "US",
      timezone: "America/New_York",
      source: "navigator.geolocation",
      fetchedAt: new Date().toISOString()
    }
  });
  try {
    const result = await refreshLocationIfAlreadyGranted();
    assert.equal(result.ok, true);
    assert.equal(result.refreshed, false);
    assert.equal(result.reason, "fresh_cache");
    assert.equal(result.location.city, "Raleigh");
    assert.equal(mock.geolocationCalls, 0);
  } finally {
    mock.restore();
  }
});
