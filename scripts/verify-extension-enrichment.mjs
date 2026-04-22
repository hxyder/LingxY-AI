// Verify that the UCA-160/161/162 extension upgrades are intact:
// - context-enricher.js exports the expected enrichment helpers
// - sse-client.js exports the stream readers
// - standalone-client.buildPromptFor accepts an enrichment markdown arg
// - service-worker imports them and wires them into runQuickAction +
//   dispatchOverlayHandoff
// - popup/index.html has the chat panel wired

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd());

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  }
}

async function read(relPath) {
  return readFile(path.join(ROOT, relPath), "utf8");
}

async function main() {
  const contextEnricher = await read("browser_ext/background/context-enricher.js");
  assert(/export function shouldEnrichForAction\b/.test(contextEnricher),
    "context-enricher.js exports shouldEnrichForAction");
  assert(/export async function enrichContextForAction\b/.test(contextEnricher),
    "context-enricher.js exports enrichContextForAction");
  assert(/export function formatEnrichmentAsMarkdown\b/.test(contextEnricher),
    "context-enricher.js exports formatEnrichmentAsMarkdown");
  assert(/MAX_LINKS\s*=\s*3/.test(contextEnricher),
    "context-enricher caps link fetches at 3");
  assert(/LINK_TIMEOUT_MS\s*=\s*3_?000/.test(contextEnricher),
    "context-enricher link fetch timeout is 3s");

  const sseClient = await read("browser_ext/background/sse-client.js");
  assert(/export async function\* readSseFrames\b/.test(sseClient),
    "sse-client.js exports readSseFrames");
  assert(/export async function runTaskWithStream\b/.test(sseClient),
    "sse-client.js exports runTaskWithStream");
  assert(/text\/event-stream/.test(sseClient),
    "sse-client.js sets Accept: text/event-stream");

  const standaloneClient = await read("browser_ext/background/standalone-client.js");
  assert(/buildPromptFor\(action,\s*selectionState\s*=\s*\{\},\s*enrichmentMarkdown/.test(standaloneClient),
    "buildPromptFor accepts enrichmentMarkdown arg");

  const serviceWorker = await read("browser_ext/background/service-worker.js");
  assert(/from\s+["']\.\/context-enricher\.js["']/.test(serviceWorker),
    "service-worker imports context-enricher");
  assert(/from\s+["']\.\/sse-client\.js["']/.test(serviceWorker),
    "service-worker imports sse-client");
  assert(/runTaskWithStream\(/.test(serviceWorker),
    "service-worker calls runTaskWithStream in runQuickAction");
  assert(/shouldEnrichForAction\(/.test(serviceWorker),
    "service-worker gates enrichment with shouldEnrichForAction");
  assert(/uca\.standalone\.chat/.test(serviceWorker),
    "service-worker handles uca.standalone.chat message");

  const popupHtml = await read("browser_ext/popup/index.html");
  assert(/id="chat-history"/.test(popupHtml), "popup has #chat-history");
  assert(/id="chat-input"/.test(popupHtml), "popup has #chat-input");
  assert(/id="chat-form"/.test(popupHtml), "popup has #chat-form");

  const popupJs = await read("browser_ext/popup/index.js");
  assert(/uca\.standalone\.chat/.test(popupJs),
    "popup sends uca.standalone.chat");
  assert(/chrome\.storage\.session/.test(popupJs) || /CHAT_HISTORY_KEY/.test(popupJs),
    "popup persists chat history");

  if (process.exitCode) {
    console.error("Extension enrichment verification FAILED.");
    process.exit(process.exitCode);
  }
  console.log("Extension enrichment verification passed (UCA-160/161/162).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
