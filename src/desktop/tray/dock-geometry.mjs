export const DOCK_SIZE_PX = 48;
export const DOCK_EDGE_SNAP_PX = 16;
export const DOCK_LEGACY_EDGE_TOLERANCE_PX = 24;

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function roundBounds(bounds = {}) {
  return {
    x: Math.round(finiteNumber(bounds.x, 0)),
    y: Math.round(finiteNumber(bounds.y, 0)),
    width: Math.round(finiteNumber(bounds.width, 0)),
    height: Math.round(finiteNumber(bounds.height, 0))
  };
}

export function dockDisplayArea(display = {}, fallbackArea = null) {
  const source = display.bounds ?? display.workArea ?? fallbackArea ?? { x: 0, y: 0, width: DOCK_SIZE_PX, height: DOCK_SIZE_PX };
  const area = roundBounds(source);
  return {
    x: area.x,
    y: area.y,
    width: Math.max(DOCK_SIZE_PX, area.width),
    height: Math.max(DOCK_SIZE_PX, area.height)
  };
}

export function dockDefaultBounds(display = {}, { bottomOffset = 56, fallbackArea = null } = {}) {
  const area = dockDisplayArea(display, fallbackArea);
  return {
    x: area.x + area.width - DOCK_SIZE_PX,
    y: Math.max(area.y, area.y + area.height - DOCK_SIZE_PX - Math.max(0, Math.round(bottomOffset))),
    width: DOCK_SIZE_PX,
    height: DOCK_SIZE_PX
  };
}

export function normalizeDockBounds(bounds = {}, display = {}, {
  fallbackArea = null,
  migrateLegacy = false,
  snap = false,
  edgeTolerance = DOCK_LEGACY_EDGE_TOLERANCE_PX
} = {}) {
  const area = dockDisplayArea(display, fallbackArea);
  const raw = roundBounds({
    ...bounds,
    width: finiteNumber(bounds.width, DOCK_SIZE_PX),
    height: finiteNumber(bounds.height, DOCK_SIZE_PX)
  });
  let x = raw.x;
  let y = raw.y;

  if (migrateLegacy && (raw.width !== DOCK_SIZE_PX || raw.height !== DOCK_SIZE_PX)) {
    const areaRight = area.x + area.width;
    const areaBottom = area.y + area.height;
    if (Math.abs(raw.x - area.x) <= edgeTolerance) {
      x = area.x;
    } else if (Math.abs(raw.x + raw.width - areaRight) <= edgeTolerance) {
      x = areaRight - DOCK_SIZE_PX;
    }
    if (Math.abs(raw.y - area.y) <= edgeTolerance) {
      y = area.y;
    } else if (Math.abs(raw.y + raw.height - areaBottom) <= edgeTolerance) {
      y = areaBottom - DOCK_SIZE_PX;
    }
  }

  const minX = area.x;
  const minY = area.y;
  const maxX = area.x + Math.max(0, area.width - DOCK_SIZE_PX);
  const maxY = area.y + Math.max(0, area.height - DOCK_SIZE_PX);
  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(minY, Math.min(maxY, y));

  if (snap) {
    if (Math.abs(x - minX) <= DOCK_EDGE_SNAP_PX) x = minX;
    if (Math.abs(x - maxX) <= DOCK_EDGE_SNAP_PX) x = maxX;
    if (Math.abs(y - minY) <= DOCK_EDGE_SNAP_PX) y = minY;
    if (Math.abs(y - maxY) <= DOCK_EDGE_SNAP_PX) y = maxY;
  }

  return {
    x,
    y,
    width: DOCK_SIZE_PX,
    height: DOCK_SIZE_PX
  };
}
