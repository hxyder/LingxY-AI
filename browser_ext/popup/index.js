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

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  requestRecentTasks(chrome).then((tasks) => renderTaskList(tasks));
}
