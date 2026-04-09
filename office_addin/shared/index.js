import { createOfficeBridge } from "./office_bridge.js";
import { createOfficeTaskPaneViewModel } from "./office_runtime.js";

const bridge = createOfficeBridge();

async function refreshSelection() {
  const selection = await bridge.captureSelection();
  const viewModel = createOfficeTaskPaneViewModel(selection, bridge.getTransportPlan());
  document.getElementById("selection-preview").textContent = viewModel.previewText;
  document.getElementById("transport-status").textContent = viewModel.transportStatus;
}

async function submit(command) {
  const selection = await bridge.captureSelection();
  await bridge.submitSelection(command, selection);
  await refreshSelection();
}

document.getElementById("summarize-selection")?.addEventListener("click", () => submit("请总结这段 Office 内容"));
document.getElementById("rewrite-selection")?.addEventListener("click", () => submit("请改写这段 Office 内容"));

refreshSelection();
