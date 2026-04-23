#!/usr/bin/env node
/**
 * verify-chat-composer.mjs — UCA-126 Phase 7d
 *
 *   - Chat composer gains attach + voice icon-buttons, a model chip, and
 *     a toolbar row separating the textarea from controls.
 *   - console.js adds appendConsoleChatToolCall() for tool-call cards, and
 *     updates appendConsoleChatMessage() to produce .chat-msg / .chat-msg-av
 *     / .chat-msg-body / .chat-msg-bubble structure.
 *   - shared.css provides .chat-msg, .chat-msg-av, .chat-msg-bubble,
 *     .chat-tool-card, and .console-chat-toolbar styles.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const html = read("src/desktop/renderer/console.html");
const js = read("src/desktop/renderer/console.js");
const css = read("src/desktop/renderer/shared.css");

// HTML: composer toolbar + 3 rich buttons + attachment bar + file input.
assert.match(html, /<div class="console-chat-toolbar">/, "console.html missing .console-chat-toolbar");
assert.match(html, /id="consoleChatAttachBtn"/, "console.html missing consoleChatAttachBtn");
assert.match(html, /id="consoleChatVoiceBtn"/, "console.html missing consoleChatVoiceBtn");
assert.match(html, /id="consoleChatModelChip"/, "console.html missing consoleChatModelChip");
assert.match(html, /id="consoleChatModelChipLabel"/, "console.html missing consoleChatModelChipLabel");
assert.match(html, /<input id="consoleChatAttachInput"[^>]*type="file"[^>]*multiple/, "console.html missing multi-file attach input");
assert.match(html, /<div id="consoleChatAttachments"[^>]*class="console-chat-attachments"/, "console.html missing attachment chip row");

// CSS: rich message classes.
assert.match(css, /\.chat-msg\s*\{/, "shared.css missing .chat-msg");
assert.match(css, /\.chat-msg-av\s*\{/, "shared.css missing .chat-msg-av");
assert.match(css, /\.chat-msg-body\s*\{/, "shared.css missing .chat-msg-body");
assert.match(css, /\.chat-msg-bubble\s*\{/, "shared.css missing .chat-msg-bubble");
assert.match(css, /\.chat-tool-card\s*\{/, "shared.css missing .chat-tool-card");
assert.match(css, /\.console-chat-toolbar\s*\{/, "shared.css missing .console-chat-toolbar");
assert.match(css, /\.console-chat-attachments\s*\{/, "shared.css missing .console-chat-attachments");
assert.match(css, /\.console-chat-toolbar\s+\.model-chip\s*\{/, "shared.css missing toolbar model-chip rule");

// User / AI / system distinction styled.
assert.match(css, /\.chat-msg\.user\s+\.chat-msg-bubble/, "shared.css missing user bubble styling");
assert.match(css, /\.chat-msg\.system\s+\.chat-msg-bubble/, "shared.css missing system bubble styling");

// JS: rich-message function produces .chat-msg DOM.
assert.match(js, /function appendConsoleChatMessage\(/, "console.js missing appendConsoleChatMessage");
assert.match(js, /wrapper\.className = `chat-msg \$\{role\}`/, "appendConsoleChatMessage must create .chat-msg wrapper");
assert.match(js, /chat-msg-av/, "appendConsoleChatMessage must create .chat-msg-av");
assert.match(js, /chat-msg-bubble/, "appendConsoleChatMessage must create .chat-msg-bubble");

// Tool call helper + attach handlers + model chip updater.
assert.match(js, /function appendConsoleChatToolCall\(/, "console.js missing appendConsoleChatToolCall");
assert.match(js, /function renderChatAttachments\(/, "console.js missing renderChatAttachments");
assert.match(js, /function updateChatModelChip\(/, "console.js missing updateChatModelChip");
assert.match(js, /consoleChatAttachBtn\?\.addEventListener\("click"/, "console.js must wire attach button click");
assert.match(js, /consoleChatVoiceBtn\?\.addEventListener\("click"/, "console.js must wire voice button click");
assert.match(js, /consoleChatAttachInput\?\.addEventListener\("change"/, "console.js must wire attach input change");
assert.match(js, /consoleChatAttachList\.length\s*=\s*0/, "console.js must clear attach list after submit");

console.log("ok verify-chat-composer");
