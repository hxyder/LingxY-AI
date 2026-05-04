import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCK_EDGE_SNAP_PX,
  DOCK_SIZE_PX,
  dockDefaultBounds,
  normalizeDockBounds
} from "../../src/desktop/tray/dock-geometry.mjs";

const display = {
  bounds: { x: 100, y: 50, width: 1920, height: 1080 },
  workArea: { x: 100, y: 50, width: 1920, height: 1040 }
};

test("dock geometry migrates legacy oversized right/bottom bounds to a 48px edge orb", () => {
  const migrated = normalizeDockBounds({
    x: 100 + 1920 - 320,
    y: 50 + 1080 - 240,
    width: 320,
    height: 240
  }, display, { migrateLegacy: true });

  assert.deepEqual(migrated, {
    x: 100 + 1920 - DOCK_SIZE_PX,
    y: 50 + 1080 - DOCK_SIZE_PX,
    width: DOCK_SIZE_PX,
    height: DOCK_SIZE_PX
  });
});

test("dock geometry clamps and snaps movement to display bounds", () => {
  const nearRight = normalizeDockBounds({
    x: 100 + 1920 - DOCK_SIZE_PX - DOCK_EDGE_SNAP_PX + 1,
    y: 51,
    width: DOCK_SIZE_PX,
    height: DOCK_SIZE_PX
  }, display, { snap: true });

  assert.equal(nearRight.x, 100 + 1920 - DOCK_SIZE_PX);
  assert.equal(nearRight.y, 50);

  const outside = normalizeDockBounds({
    x: 10_000,
    y: -10_000,
    width: 999,
    height: 999
  }, display);

  assert.equal(outside.x, 100 + 1920 - DOCK_SIZE_PX);
  assert.equal(outside.y, 50);
  assert.equal(outside.width, DOCK_SIZE_PX);
  assert.equal(outside.height, DOCK_SIZE_PX);
});

test("dock default uses physical display bounds for the right edge", () => {
  const defaults = dockDefaultBounds(display);

  assert.equal(defaults.x, 100 + 1920 - DOCK_SIZE_PX);
  assert.equal(defaults.y, 50 + 1080 - DOCK_SIZE_PX - 56);
  assert.equal(defaults.width, DOCK_SIZE_PX);
  assert.equal(defaults.height, DOCK_SIZE_PX);
});
