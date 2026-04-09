const dockButton = document.querySelector("#dockButton");
let dragDepth = 0;

function collectFilePaths(event) {
  const files = [...(event.dataTransfer?.files ?? [])];
  return window.ucaShell.resolveDroppedFilePaths(files);
}

function hasFilePayload(event) {
  const types = [...(event.dataTransfer?.types ?? [])];
  return types.includes("Files");
}

function setDragState(active) {
  dockButton.classList.toggle("dragover", active);
}

dockButton.addEventListener("click", async () => {
  await window.ucaShell.showWindow("overlay");
});

function handleDragEnter(event) {
  if (!hasFilePayload(event)) {
    return;
  }
  event.preventDefault();
  dragDepth += 1;
  setDragState(true);
}

function handleDragOver(event) {
  if (!hasFilePayload(event)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setDragState(true);
}

function handleDragLeave(event) {
  if (!hasFilePayload(event)) {
    return;
  }
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    setDragState(false);
  }
}

async function handleDrop(event) {
  if (!hasFilePayload(event)) {
    return;
  }
  event.preventDefault();
  dragDepth = 0;
  setDragState(false);
  const filePaths = collectFilePaths(event);
  if (filePaths.length === 0) {
    await window.ucaShell.notify({
      title: "UCA Dock",
      body: "没有识别到可提交的文件。"
    });
    return;
  }
  const result = await window.ucaShell.submitDroppedFiles(filePaths);
  if (result?.accepted) {
    await window.ucaShell.notify({
      title: "UCA Dock",
      body: `已接收 ${result.fileCount} 个文件，请输入你的要求。`
    });
  }
}

["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    if (!hasFilePayload(event)) {
      return;
    }
    event.preventDefault();
  });
});

window.addEventListener("dragenter", handleDragEnter);
window.addEventListener("dragover", handleDragOver);
window.addEventListener("dragleave", handleDragLeave);
window.addEventListener("drop", handleDrop);
