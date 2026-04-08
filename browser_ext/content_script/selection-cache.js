function createFloatingChipController(doc = document) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-floating-chip", "true");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
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

export function captureSelectionState(doc = document) {
  const selection = doc.getSelection();
  const text = selection?.toString().trim() ?? "";
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect?.();

  return {
    text,
    contextBefore: text ? text.slice(0, 100) : "",
    contextAfter: text ? text.slice(-100) : "",
    rect: rect
      ? {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        }
      : null
  };
}

export function installSelectionObserver(doc = document) {
  const chip = createFloatingChipController(doc);

  doc.addEventListener("selectionchange", () => {
    const state = captureSelectionState(doc);
    window.__ucaSelectionState = state;

    if (state.text.length >= 5 && state.rect) {
      chip.show({
        rect: state.rect,
        label: "用 UCA 总结"
      });
      return;
    }

    chip.hide();
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installSelectionObserver(document);
}
