export function parseManualReleasePassRows(matrixText) {
  const marker = "## Manual Release Pass";
  const startIndex = matrixText.indexOf(marker);
  if (startIndex < 0) {
    return [];
  }

  const afterMarker = matrixText.slice(startIndex + marker.length);
  const endIndex = afterMarker.search(/\n## /u);
  const section = endIndex >= 0 ? afterMarker.slice(0, endIndex) : afterMarker;
  const rows = [];

  for (const line of section.split(/\r?\n/u)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const [area, manualPass] = cells;
    if (!area || area === "Area" || /^-+$/u.test(area)) continue;
    if (/^-+$/u.test(manualPass)) continue;
    rows.push({ area, manualPass });
  }

  return rows;
}

export function outcomeLabelForManualArea(area) {
  return `${area} result`;
}

