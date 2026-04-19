export const DEFAULT_FLOATING_CHIP_THEME = Object.freeze({
  chipWidth: 182,
  chipHeight: 44,
  gapX: 16,
  gapY: 8
});

export function createFloatingChipController(doc = document, theme = DEFAULT_FLOATING_CHIP_THEME) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-floating-chip", "true");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      button {
        all: initial;
        min-width: ${theme.chipWidth}px;
        box-sizing: border-box;
        font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        font-size: 12px;
        padding: 10px 14px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(13, 148, 136, 0.96), rgba(21, 94, 117, 0.96));
        color: white;
        cursor: pointer;
        box-shadow: 0 12px 26px rgba(8, 47, 73, 0.22);
      }
    </style>
    <button type="button">用 LingxY 总结</button>
  `;

  const button = root.querySelector("button");
  host.style.position = "fixed";
  host.style.display = "none";
  host.style.zIndex = "2147483647";
  doc.documentElement.appendChild(host);

  return {
    show({ rect, label }) {
      button.textContent = label;
      host.style.left = `${rect.left + rect.width + theme.gapX}px`;
      host.style.top = `${Math.max(rect.top - theme.gapY, 12)}px`;
      host.style.display = "block";
    },
    hide() {
      host.style.display = "none";
    }
  };
}
