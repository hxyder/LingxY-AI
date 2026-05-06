import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUserLocation,
  getUserLocation,
  hydrateUserLocation,
  serializeUserLocation,
  setUserLocation
} from "../../src/service/utils/location.mjs";

test("location cache can hydrate a persisted fix after restart", () => {
  clearUserLocation();
  const fetchedAt = new Date().toISOString();
  const hydrated = hydrateUserLocation({
    latitude: 35.7796,
    longitude: -78.6382,
    city: "Raleigh",
    principalSubdivision: "North Carolina",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
    accuracyMeters: 25,
    source: "windows.geocoordinatewatcher",
    fetchedAt
  });

  assert.equal(hydrated.city, "Raleigh");
  assert.equal(getUserLocation()?.city, "Raleigh");
  assert.equal(serializeUserLocation()?.fetchedAt, fetchedAt);
});

test("location hydration preserves age so stale places expire", () => {
  clearUserLocation();
  hydrateUserLocation({
    latitude: 35.7796,
    longitude: -78.6382,
    city: "Raleigh",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
    fetchedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  });

  assert.equal(getUserLocation(), null);
  assert.equal(getUserLocation({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 })?.city, "Raleigh");
});

test("fresh location updates replace hydrated location", () => {
  clearUserLocation();
  hydrateUserLocation({
    latitude: 35.7796,
    longitude: -78.6382,
    city: "Raleigh",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
    fetchedAt: new Date().toISOString()
  });

  setUserLocation({
    latitude: 40.7128,
    longitude: -74.0060,
    city: "New York",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York"
  });

  assert.equal(getUserLocation()?.city, "New York");
  assert.equal(serializeUserLocation()?.city, "New York");
});
