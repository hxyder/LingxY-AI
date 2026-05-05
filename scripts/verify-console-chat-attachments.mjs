#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createConsoleChatAttachmentsController } from "../src/desktop/renderer/console-chat-attachments.mjs";

const { document, Event } = parseHTML(`
  <button id="attachBtn" type="button"></button>
  <input id="attachInput" type="file" multiple>
  <div id="attachments" hidden></div>
  <section id="shell">
    <div id="dropZone" hidden></div>
  </section>
`);

const attachButton = document.querySelector("#attachBtn");
const attachInput = document.querySelector("#attachInput");
const attachmentsEl = document.querySelector("#attachments");
const dropShell = document.querySelector("#shell");
const dropZone = document.querySelector("#dropZone");

let clicked = 0;
attachInput.click = () => { clicked += 1; };

let resolveCalls = 0;
let thumbCalls = 0;
const shell = {
  resolveDroppedFilePaths(files) {
    resolveCalls += 1;
    return Array.from(files).map((file) => `E:/tmp/${file.name}`);
  },
  async readFileAsDataUrl(filePath) {
    thumbCalls += 1;
    return `data:image/png;base64,${Buffer.from(filePath).toString("base64")}`;
  }
};

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const controller = createConsoleChatAttachmentsController({
  attachButton,
  attachInput,
  attachmentsEl,
  dropShell,
  dropZone,
  shell,
  documentRef: document,
  escapeHtml,
  isImagePath: (filePath) => /\.png$/i.test(filePath),
  imageMimeFor: () => "image/png"
});

attachButton.dispatchEvent(new Event("click"));
assert.equal(clicked, 1, "attach button should click hidden file input");

Object.defineProperty(attachInput, "files", {
  configurable: true,
  value: [{ name: "diagram.png", path: "" }]
});
attachInput.value = "C:/fakepath/diagram.png";
attachInput.dispatchEvent(new Event("change"));
assert.equal(resolveCalls, 1, "input change should resolve native file paths");
assert.equal(attachInput.value, "", "input change should reset file input value");
assert.deepEqual(controller.getFilePaths(), ["E:/tmp/diagram.png"], "controller should expose attachment paths");
assert.equal(attachmentsEl.hidden, false, "attachment row should be visible after add");
assert.ok(attachmentsEl.querySelector(".chip-attach--image"), "image attachment should render image chip");
assert.ok(!attachmentsEl.querySelector(".chip-attach-thumb img"), "image chip should start with placeholder");

await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(thumbCalls, 1, "image thumbnail should load once");
assert.ok(attachmentsEl.querySelector(".chip-attach-thumb img"), "image thumbnail should replace placeholder");

controller.render();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(thumbCalls, 1, "thumbnail cache should avoid duplicate reads");

attachmentsEl.querySelector("[data-remove-attach]").dispatchEvent(new Event("click"));
assert.deepEqual(controller.getFilePaths(), [], "remove button should delete the attachment");
assert.equal(attachmentsEl.hidden, true, "empty attachment row should be hidden");

const dragEnter = new Event("dragenter", { bubbles: true, cancelable: true });
Object.defineProperty(dragEnter, "dataTransfer", { value: { types: ["Files"] } });
dropShell.dispatchEvent(dragEnter);
assert.equal(dropZone.hidden, false, "file dragenter should show drop zone");

let prevented = 0;
let stopped = 0;
const drop = new Event("drop", { bubbles: true, cancelable: true });
Object.defineProperty(drop, "dataTransfer", {
  value: {
    types: ["Files"],
    files: [{ name: "notes.txt", path: "" }]
  }
});
drop.preventDefault = () => { prevented += 1; };
drop.stopPropagation = () => { stopped += 1; };
dropShell.dispatchEvent(drop);
assert.equal(prevented, 1, "drop should prevent default file-open behavior");
assert.equal(stopped, 1, "drop should stop propagation");
assert.equal(dropZone.hidden, true, "drop should hide drop zone");
assert.deepEqual(controller.getFilePaths(), ["E:/tmp/notes.txt"], "drop should add resolved file paths");

controller.clear();
assert.deepEqual(controller.getFilePaths(), [], "clear should reset attachment paths");
assert.equal(attachmentsEl.hidden, true, "clear should hide attachment row");

console.log("ok verify-console-chat-attachments");
