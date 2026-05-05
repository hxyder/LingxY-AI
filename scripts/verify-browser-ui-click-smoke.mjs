#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const importFresh = (relativePath, tag) =>
  import(`${pathToFileURL(path.join(repoRoot, relativePath)).href}?smoke=${tag}-${Date.now()}`);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function createPort(name, transcript) {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    name,
    onMessage: {
      addListener(fn) { messageListeners.push(fn); }
    },
    onDisconnect: {
      addListener(fn) { disconnectListeners.push(fn); }
    },
    postMessage(payload) {
      transcript.ports.push({ name, payload });
      setTimeout(() => {
        for (const fn of messageListeners) fn({ type: "start" });
        for (const fn of messageListeners) fn({ type: "chunk", delta: "ok", full: "ok" });
        for (const fn of messageListeners) fn({ type: "done", text: "ok" });
      }, 0);
    },
    disconnect() {
      for (const fn of disconnectListeners) fn();
    }
  };
}

function createChromeStub(transcript, { executeMode = "page", initialStorage = {} } = {}) {
  const storage = new Map(Object.entries(initialStorage));
  return {
    runtime: {
      id: "test-extension",
      lastError: null,
      sendNativeMessage(host, payload, callback) {
        transcript.nativeMessages.push({ host, payload });
        callback?.({ payload: { tasks: [{ intent: "demo task", status: "success" }] } });
      },
      sendMessage(payload, callback) {
        transcript.messages.push(payload);
        if (payload?.type === "uca.overlay.getSettings") {
          callback?.({
            settings: { enabled: true, displayMode: "smart" },
            securityState: { presenterMode: false }
          });
        } else if (payload?.type === "uca.overlay.updateSettings") {
          callback?.({
            settings: { enabled: payload.patch?.enabled ?? true, displayMode: payload.patch?.displayMode ?? "smart" }
          });
        } else if (payload?.type === "uca.standalone.status") {
          callback?.({ desktopAvailable: true, standaloneReady: true, runtimeUrl: "http://127.0.0.1:4321" });
        } else if (payload?.type === "uca.page.explain") {
          callback?.({ ok: true });
        } else if (payload?.type === "uca.sidepanel.open") {
          callback?.({ ok: true });
        } else if (payload?.type === "uca.runtime.openTasks") {
          callback?.({ ok: true });
        } else {
          callback?.({ ok: true });
        }
      },
      connect({ name }) {
        return createPort(name, transcript);
      },
      openOptionsPage() {
        transcript.openOptions += 1;
      }
    },
    storage: {
      session: {
        async get(key) { return { [key]: storage.get(key) }; },
        async set(obj) {
          for (const [key, value] of Object.entries(obj)) storage.set(key, value);
          transcript.storageSets.push(obj);
        }
      },
      local: {
        async get(key) { return { [key]: storage.get(key) }; },
        async set(obj) {
          for (const [key, value] of Object.entries(obj)) storage.set(key, value);
          transcript.storageSets.push(obj);
        },
        async remove(key) {
          storage.delete(key);
          transcript.storageRemoves.push(key);
        }
      },
      onChanged: {
        addListener(fn) {
          transcript.storageListeners.push(fn);
        }
      }
    },
    windows: {
      async getCurrent() { return { id: 42 }; }
    },
    tabs: {
      async query() { return [{ id: 7, title: "Example Page", url: "https://example.test/article" }]; }
    },
    sidePanel: {
      async setOptions(options) { transcript.sidePanelOptions.push(options); },
      async open(options) { transcript.sidePanelOpens.push(options); }
    },
    scripting: {
      async executeScript(details) {
        const source = String(details?.func ?? "");
        transcript.scriptCalls.push(source);
        if (source.includes("__ucaPageSourceCapture")) {
          return [{ result: executeMode === "video" ? {
            kind: "video",
            youtube: { title: "Video Title", author: "Author", transcriptBody: "Transcript body" }
          } : null }];
        }
        if (source.includes("window.getSelection")) {
          return [{ result: { text: "selected text", url: "https://example.test/article", title: "Example Page" } }];
        }
        if (source.includes("document.title")) {
          return [{ result: { title: "Example Page", metaDesc: "Summary", text: "Readable body text" } }];
        }
        return [{ result: null }];
      }
    }
  };
}

function installBrowserGlobals(html, chromeStub) {
  const { document, Event, window } = parseHTML(html);
  window.close = () => { chromeStub.__transcript.closed += 1; };
  window.confirm = () => true;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.Event = Event;
  globalThis.chrome = chromeStub;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 35.7796, longitude: -78.6382, accuracy: 25 } });
        }
      }
    }
  });
  globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return { city: "Raleigh", principalSubdivision: "NC", countryName: "United States", countryCode: "US" };
      }
    });
  for (const id of ["display-mode", "overlay-enabled", "chat-input", "sp-input"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    let value = el.getAttribute("value") ?? "";
    let checked = el.hasAttribute("checked");
    Object.defineProperty(el, "value", {
      configurable: true,
      get() { return value; },
      set(next) { value = String(next ?? ""); }
    });
    Object.defineProperty(el, "checked", {
      configurable: true,
      get() { return checked; },
      set(next) { checked = Boolean(next); }
    });
  }
  return { document, Event, window };
}

function createTranscript() {
  return {
    nativeMessages: [],
    messages: [],
    ports: [],
    storageSets: [],
    storageRemoves: [],
    storageListeners: [],
    scriptCalls: [],
    sidePanelOptions: [],
    sidePanelOpens: [],
    openOptions: 0,
    closed: 0
  };
}

async function verifyPopupClicks() {
  const transcript = createTranscript();
  const chromeStub = createChromeStub(transcript);
  chromeStub.__transcript = transcript;
  const { document, Event } = installBrowserGlobals(read("browser_ext/popup/index.html"), chromeStub);
  await importFresh("browser_ext/popup/index.js", "popup");

  await tick();
  assert.equal(document.querySelectorAll("#task-list .task-item").length, 1,
    "popup should render recent tasks from native message response");

  document.getElementById("display-mode").value = "manual";
  document.getElementById("display-mode").dispatchEvent(new Event("change"));
  await tick();
  assert.ok(transcript.messages.some((msg) =>
    msg.type === "uca.overlay.updateSettings" && msg.patch?.displayMode === "manual"),
  "popup display-mode change should update overlay settings");

  document.getElementById("overlay-enabled").checked = false;
  document.getElementById("overlay-enabled").dispatchEvent(new Event("change"));
  await tick();
  assert.ok(transcript.messages.some((msg) =>
    msg.type === "uca.overlay.updateSettings" && msg.patch?.enabled === false),
  "popup overlay toggle should update overlay settings");

  document.getElementById("chat-input").value = "hello";
  document.getElementById("chat-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  assert.ok(transcript.ports.some((port) =>
    port.name === "uca.chat.stream" && port.payload?.type === "chat" && port.payload?.text === "hello"),
  "popup chat submit should use the streaming chat port");

  document.getElementById("explain-page").dispatchEvent(new Event("click"));
  await tick();
  assert.ok(transcript.messages.some((msg) => msg.type === "uca.page.explain"),
    "popup explain-page click should request page explanation");
  assert.equal(transcript.sidePanelOpens.length, 1,
    "popup explain-page should open the side panel after a successful request");

  document.getElementById("open-sidepanel").dispatchEvent(new Event("click"));
  await tick();
  assert.ok(transcript.sidePanelOptions.some((entry) => entry.path === "sidepanel/index.html"),
    "popup open-sidepanel should configure the side panel path");

  document.getElementById("open-options").dispatchEvent(new Event("click"));
  assert.equal(transcript.openOptions, 1, "popup options button should open extension options");

  document.getElementById("open-console").dispatchEvent(new Event("click"));
  await tick();
  assert.ok(transcript.messages.some((msg) => msg.type === "uca.runtime.openTasks"),
    "popup open-console button should ask the runtime to open tasks");
}

async function verifySidePanelClicks() {
  const transcript = createTranscript();
  const chromeStub = createChromeStub(transcript);
  chromeStub.__transcript = transcript;
  const { document, Event } = installBrowserGlobals(read("browser_ext/sidepanel/index.html"), chromeStub);
  await importFresh("browser_ext/sidepanel/index.js", "sidepanel");

  await tick();
  document.getElementById("sp-input").value = "hello sidepanel";
  document.getElementById("sp-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  assert.ok(transcript.ports.some((port) =>
    port.name === "uca.chat.stream" && port.payload?.type === "chat" && port.payload?.text === "hello sidepanel"),
  "sidepanel submit should use the streaming chat port");

  document.getElementById("sp-action-clear").dispatchEvent(new Event("click"));
  await tick();
  assert.ok(transcript.storageSets.some((obj) =>
    Array.isArray(obj.ucaSidePanelHistory) && obj.ucaSidePanelHistory.length === 0),
  "sidepanel clear should persist an empty conversation");

  document.getElementById("sp-action-selection").dispatchEvent(new Event("click"));
  await tick();
  await tick();
  assert.ok(transcript.scriptCalls.some((source) => source.includes("window.getSelection")),
    "sidepanel selection action should read the active tab selection");

  document.getElementById("sp-action-page").dispatchEvent(new Event("click"));
  await tick();
  await tick();
  assert.ok(transcript.scriptCalls.some((source) => source.includes("__ucaPageSourceCapture")),
    "sidepanel page action should try the page-source capture bridge");

  document.getElementById("sp-action-location").dispatchEvent(new Event("click"));
  await tick();
  await tick();
  assert.ok(transcript.storageSets.some((obj) => obj.ucaUserLocation?.city === "Raleigh"),
    "sidepanel location click should request and cache browser geolocation");

  document.getElementById("sp-options-btn").dispatchEvent(new Event("click"));
  assert.equal(transcript.openOptions, 1, "sidepanel options button should open extension options");
}

async function verifySidePanelPendingQuickAction() {
  const pending = {
    id: "pending-1",
    kind: "quickaction",
    action: "uca.fetch-link",
    selectionState: { url: "https://example.test/story", anchorText: "Example story" },
    displayLabel: "分析链接",
    attached: "URL: https://example.test/story",
    routePlan: { transport: "standalone_direct", reason: "smoke" }
  };
  const transcript = createTranscript();
  const chromeStub = createChromeStub(transcript, {
    initialStorage: { ucaSidePanelPendingAnalysis: pending }
  });
  chromeStub.__transcript = transcript;
  installBrowserGlobals(read("browser_ext/sidepanel/index.html"), chromeStub);
  await importFresh("browser_ext/sidepanel/index.js", "sidepanel-pending");

  await tick();
  await tick();
  assert.ok(transcript.storageRemoves.includes("ucaSidePanelPendingAnalysis"),
    "sidepanel should consume pending analysis requests on boot");
  assert.ok(transcript.ports.some((port) =>
    port.name === "uca.quickaction.stream"
    && port.payload?.type === "quickaction"
    && port.payload?.action === "uca.fetch-link"
    && port.payload?.routePlan?.transport === "standalone_direct"),
  "sidepanel pending quick action should preserve action, selection state, and route plan");
}

async function verifySidePanelPendingPageExplainRoutePlan() {
  const routePlan = { ok: true, transport: "standalone_direct", ui: "sidepanel_pending", reason: "smoke" };
  const pending = {
    id: "pending-page-1",
    kind: "page_explain",
    routePlan
  };
  const transcript = createTranscript();
  const chromeStub = createChromeStub(transcript, {
    initialStorage: { ucaSidePanelPendingAnalysis: pending }
  });
  chromeStub.__transcript = transcript;
  installBrowserGlobals(read("browser_ext/sidepanel/index.html"), chromeStub);
  await importFresh("browser_ext/sidepanel/index.js", "sidepanel-pending-page");

  await tick();
  await tick();
  assert.ok(transcript.ports.some((port) =>
    port.name === "uca.chat.stream"
    && port.payload?.type === "chat"
    && port.payload?.routePlan?.transport === "standalone_direct"
    && port.payload?.routePlan?.ui === "sidepanel_pending"),
  "sidepanel pending page explain should preserve route plan on the chat stream");
}

async function verifySidePanelPendingRuntimeUnavailable() {
  const routePlan = {
    ok: false,
    origin: "context_menu",
    actionKind: "image",
    ui: "error",
    transport: "none",
    mode: "offline",
    reason: "no_vision_runtime"
  };
  const pending = {
    id: "pending-runtime-unavailable-1",
    kind: "runtime_unavailable",
    routePlan
  };
  const transcript = createTranscript();
  const chromeStub = createChromeStub(transcript, {
    initialStorage: { ucaSidePanelPendingAnalysis: pending }
  });
  chromeStub.__transcript = transcript;
  installBrowserGlobals(read("browser_ext/sidepanel/index.html"), chromeStub);
  await importFresh("browser_ext/sidepanel/index.js", "sidepanel-runtime-unavailable");

  await tick();
  await tick();
  assert.ok(transcript.storageRemoves.includes("ucaSidePanelPendingAnalysis"),
    "sidepanel should consume pending runtime-unavailable notices");
  assert.equal(transcript.ports.length, 0,
    "runtime-unavailable notices should render locally without opening a streaming port");
  assert.match(document.getElementById("sp-history").textContent, /图片分析后端/,
    "runtime-unavailable notices should show a user-visible capability gap");
}

await verifyPopupClicks();
await verifySidePanelClicks();
await verifySidePanelPendingQuickAction();
await verifySidePanelPendingPageExplainRoutePlan();
await verifySidePanelPendingRuntimeUnavailable();

console.log("ok verify-browser-ui-click-smoke");
