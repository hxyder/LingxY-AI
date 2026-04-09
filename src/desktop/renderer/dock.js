const dockButton = document.querySelector("#dockButton");

function collectFilePaths(event) {
  const files = [...(event.dataTransfer?.files ?? [])];
  return files
    .map((file) => file.path)
    .filter((filePath) => typeof filePath === "string" && filePath.length > 0);
}

function setDragState(active) {
  dockButton.classList.toggle("dragover", active);
}

dockButton.addEventListener("click", async () => {
  await window.ucaShell.showWindow("overlay");
});

dockButton.addEventListener("dragenter", (event) => {
  event.preventDefault();
  setDragState(true);
});

dockButton.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setDragState(true);
});

dockButton.addEventListener("dragleave", () => {
  setDragState(false);
});

dockButton.addEventListener("drop", async (event) => {
  event.preventDefault();
  setDragState(false);
  const filePaths = collectFilePaths(event);
  if (filePaths.length === 0) {
    return;
  }
  await window.ucaShell.submitDroppedFiles(filePaths);
});
