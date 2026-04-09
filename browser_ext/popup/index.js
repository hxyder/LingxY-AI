export function renderTaskList(tasks, doc = document) {
  const list = doc.getElementById("task-list");
  list.innerHTML = "";

  for (const task of tasks) {
    const item = doc.createElement("li");
    item.className = "task-item";
    item.textContent = `${task.intent} · ${task.status}`;
    list.appendChild(item);
  }
}

export async function requestRecentTasks(chromeApi = chrome) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendNativeMessage("com.uca.host", {
      protocolVersion: "1.0",
      requestId: crypto.randomUUID(),
      action: "get_recent_tasks"
    }, (response) => {
      resolve(response?.payload?.tasks ?? []);
    });
  });
}

export async function requestOverlaySettings(chromeApi = chrome) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage({
      type: "uca.overlay.getSettings"
    }, (response) => {
      resolve(response ?? {
        settings: {
          enabled: true,
          displayMode: "smart"
        },
        securityState: {
          presenterMode: false
        }
      });
    });
  });
}

export async function updateOverlaySettings(patch, chromeApi = chrome) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage({
      type: "uca.overlay.updateSettings",
      patch
    }, (response) => resolve(response));
  });
}

export function renderOverlaySettings(model, doc = document) {
  doc.getElementById("overlay-status").textContent = model.securityState.presenterMode ? "Presenter Mode" : "正常";
  doc.getElementById("display-mode").value = model.settings.displayMode;
  doc.getElementById("overlay-enabled").checked = Boolean(model.settings.enabled);
}

async function bootPopup(doc = document, chromeApi = chrome) {
  const [tasks, overlayModel] = await Promise.all([
    requestRecentTasks(chromeApi),
    requestOverlaySettings(chromeApi)
  ]);

  renderTaskList(tasks, doc);
  renderOverlaySettings(overlayModel, doc);

  doc.getElementById("display-mode").addEventListener("change", async (event) => {
    const response = await updateOverlaySettings({
      displayMode: event.target.value
    }, chromeApi);
    renderOverlaySettings({
      settings: response.settings,
      securityState: overlayModel.securityState
    }, doc);
  });

  doc.getElementById("overlay-enabled").addEventListener("change", async (event) => {
    const response = await updateOverlaySettings({
      enabled: event.target.checked
    }, chromeApi);
    renderOverlaySettings({
      settings: response.settings,
      securityState: overlayModel.securityState
    }, doc);
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  bootPopup(document, chrome);
}
