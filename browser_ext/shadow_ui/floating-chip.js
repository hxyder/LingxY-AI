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
        font-family: "Inter", "Segoe UI Variable Text", "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 600;
        padding: 10px 14px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(184, 92, 42, 0.98), rgba(154, 74, 31, 0.98));
        color: #ffffff;
        cursor: pointer;
        box-shadow: 0 12px 26px rgba(10, 10, 10, 0.22);
      }
    </style>
    <button type="button">用 LingxY 总结</button>
  `;

  const button = root.querySelector("button");
  host.style.position = "fixed";
  host.style.display = "none";
  host.style.zIndex = "2147483647";
  host.style.width = "max-content";
  host.style.height = "max-content";
  host.style.maxWidth = "calc(100vw - 24px)";
  host.style.overflow = "visible";
  host.style.contain = "layout style paint";
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
