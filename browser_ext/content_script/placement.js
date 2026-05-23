(function bootstrapPlacement(globalScope) {
  const overlay = globalScope.__ucaOverlay ?? (globalScope.__ucaOverlay = {});

  function normalizeViewport(viewport = globalScope.visualViewport) {
    return {
      width: viewport?.width ?? globalScope.innerWidth ?? 1280,
      height: viewport?.height ?? globalScope.innerHeight ?? 720
    };
  }

  function isRectVisible(rect, viewport = normalizeViewport()) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    return rect.bottom > 0
      && rect.right > 0
      && rect.top < viewport.height
      && rect.left < viewport.width;
  }

  function computeFloatingChipPlacement(rect, options = {}) {
    const viewport = normalizeViewport(options.viewport);
    const chipWidth = options.chipWidth ?? 182;
    const chipHeight = options.chipHeight ?? 44;
    const gapX = options.gapX ?? 16;
    const gapY = options.gapY ?? 8;
    const margin = options.margin ?? 12;

    let left = rect.right + gapX;
    let top = rect.bottom + gapY;
    let horizontalPlacement = "right";
    let verticalPlacement = "below";

    if (left + chipWidth > viewport.width - margin) {
      left = rect.left - chipWidth - gapX;
      horizontalPlacement = "left";
    }

    if (left < margin) {
      left = Math.min(Math.max(rect.left, margin), viewport.width - chipWidth - margin);
      horizontalPlacement = "clamped";
    }

    if (top + chipHeight > viewport.height - margin) {
      top = rect.top - chipHeight - gapY;
      verticalPlacement = "above";
    }

    if (top < margin) {
      top = Math.min(Math.max(rect.bottom + gapY, margin), viewport.height - chipHeight - margin);
      verticalPlacement = "clamped";
    }

    return {
      left: Math.round(left),
      top: Math.round(top),
      horizontalPlacement,
      verticalPlacement
    };
  }

  overlay.isRectVisible = isRectVisible;
  overlay.computeFloatingChipPlacement = computeFloatingChipPlacement;
})(globalThis);
