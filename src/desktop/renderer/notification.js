const toast = document.querySelector("#toast");
const title = document.querySelector("#title");
const bodyText = document.querySelector("#bodyText");
const closeBtn = document.querySelector("#closeBtn");
let hideTimer = null;

function hide() {
  toast.classList.remove("visible");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    window.ucaShell.hideWindow("notification");
  }, 180);
}

function show(payload = {}) {
  title.textContent = payload.title ?? "UCA 提醒";
  bodyText.textContent = payload.body ?? payload.message ?? "时间到了";
  clearTimeout(hideTimer);
  toast.classList.add("visible");
  hideTimer = setTimeout(hide, Number(payload.durationMs ?? 8000));
}

closeBtn.addEventListener("click", hide);

window.ucaShell.onNotificationReceived((payload) => {
  show(payload);
});

window.ucaShell.onShellReady((payload) => {
  if (payload.windowId === "notification") {
    toast.classList.remove("visible");
  }
});
