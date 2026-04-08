export function createFloatingChipController(doc = document) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-floating-chip", "true");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        all: initial;
        font-family: "Segoe UI", sans-serif;
        font-size: 12px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #0f766e;
        color: white;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(15, 118, 110, 0.25);
      }
    </style>
    <button type="button">用 UCA 总结</button>
  `;

  const button = root.querySelector("button");
  host.style.position = "fixed";
  host.style.display = "none";
  host.style.zIndex = "2147483647";
  doc.documentElement.appendChild(host);

  return {
    show({ rect, label }) {
      button.textContent = label;
      host.style.left = `${rect.left + rect.width + 16}px`;
      host.style.top = `${Math.max(rect.top - 8, 12)}px`;
      host.style.display = "block";
    },
    hide() {
      host.style.display = "none";
    }
  };
}
