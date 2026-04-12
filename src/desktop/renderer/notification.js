const toast = document.querySelector("#toast");
const title = document.querySelector("#title");
const bodyText = document.querySelector("#bodyText");
const closeBtn = document.querySelector("#closeBtn");
let hideTimer = null;
let serviceBaseUrl = "http://127.0.0.1:4310";
let lastPayload = null;

function hide() {
  toast.classList.remove("visible");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    window.ucaShell.hideWindow("notification");
  }, 180);
}

function show(payload = {}) {
  lastPayload = payload;
  title.textContent = payload.title ?? "UCA 提醒";
  bodyText.textContent = payload.body ?? payload.message ?? "时间到了";
  clearTimeout(hideTimer);
  toast.classList.add("visible");
  hideTimer = setTimeout(hide, Number(payload.durationMs ?? 8000));
}

closeBtn.addEventListener("click", hide);

toast.addEventListener("click", async () => {
  const handoff = lastPayload?.handoff;
  if (handoff?.file_paths?.length) {
    try {
      await fetch(`${serviceBaseUrl}/overlay/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(handoff)
      });
    } catch {
      // ignore
    }
  } else if (lastPayload?.navigate) {
    try {
      await window.ucaShell.navigateConsole(lastPayload.navigate);
    } catch {
      await window.ucaShell.showWindow("console");
    }
  } else {
    try {
      await window.ucaShell.showWindow("console");
    } catch {
      // ignore
    }
  }
  hide();
});

window.ucaShell.onNotificationReceived((payload) => {
  show(payload);
});

window.ucaShell.onShellReady((payload) => {
  if (payload.windowId === "notification") {
    toast.classList.remove("visible");
    serviceBaseUrl = payload.serviceBaseUrl ?? serviceBaseUrl;
  }
});
