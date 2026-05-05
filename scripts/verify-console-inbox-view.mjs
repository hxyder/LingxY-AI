import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CHECK_COMMANDS } from "./check-manifest.mjs";

const viewPath = "src/desktop/renderer/console-inbox-view.mjs";
const consolePath = "src/desktop/renderer/console.js";
const packagePath = "package.json";

assert.ok(existsSync(viewPath), "console inbox pure view module must exist");

const viewSource = readFileSync(viewPath, "utf8");
const consoleSource = readFileSync(consolePath, "utf8");
const packageSource = readFileSync(packagePath, "utf8");
const pkg = JSON.parse(packageSource);

const view = await import(`../${viewPath}`);

for (const name of [
  "renderEmailHtmlFrame",
  "renderInboxAccountsHtml",
  "renderInboxContentHtml"
]) {
  assert.equal(typeof view[name], "function", `${name} must be exported by ${viewPath}`);
}

const frameHtml = view.renderEmailHtmlFrame(
  `email-"<&`,
  `<h1 title="quoted">Hi</h1><script>alert("x")</script><img src="https://tracker.invalid/pixel.png">`
);
assert.ok(frameHtml.includes(`sandbox=""`), "email HTML iframe must use an empty sandbox");
assert.ok(frameHtml.includes(`referrerpolicy="no-referrer"`), "email HTML iframe must suppress referrers");
assert.ok(frameHtml.includes(`default-src 'none'`), "email HTML iframe CSP must deny default network/script loads");
assert.ok(frameHtml.includes("Content-Security-Policy"), "email HTML iframe must embed a CSP meta tag");
assert.ok(frameHtml.includes("srcdoc="), "email HTML iframe must render through srcdoc");
assert.ok(!frameHtml.includes(`<script>`), "srcdoc attribute must not expose raw script tags in the parent document");
assert.ok(!frameHtml.includes(`alert("x")`), "srcdoc attribute must escape double quotes");
assert.ok(!frameHtml.includes(`data-email-html-frame="email-"`), "email id attribute must be escaped");

const accountsHtml = view.renderInboxAccountsHtml([
  {
    id: `acc-"1`,
    provider: "google",
    email: "me@example.com",
    displayName: "Me",
    tokenStatus: "active",
    _kind: "oauth"
  },
  {
    id: "email:imap",
    provider: "qq",
    email: "qq@example.com",
    displayName: "QQ",
    tokenStatus: "active",
    _kind: "imap"
  }
], "acc-\"1");
assert.ok(accountsHtml.includes("data-inbox-account="), "account rows must keep account selection hooks");
assert.ok(accountsHtml.includes("inbox-account active"), "account renderer must preserve active row state");
assert.ok(view.renderInboxAccountsHtml([], null).includes("inboxGoConnectorsBtn"), "empty account state must keep Connectors jump");

const filesHtml = view.renderInboxContentHtml({
  files: [{ name: `Plan <Q2>`, path: "Drive / Plan", url: `https://example.invalid/?q="<x>`, modified: "2026-05-04T12:00:00Z" }]
}, { activeTab: "files" });
assert.ok(filesHtml.includes("data-external-url="), "file rows must keep external open hook");
assert.ok(filesHtml.includes("Plan &lt;Q2&gt;"), "file rows must escape display text");

const expandedRichHtml = view.renderInboxContentHtml({
  emails: [{
    id: "m1",
    isRead: false,
    subject: "Hello",
    fromName: "Sender",
    from: "sender@example.com",
    preview: "preview",
    received: "2026-05-04T12:00:00Z",
    bodyHtml: "<p>Rich</p>",
    bodyText: "Plain"
  }]
}, {
  activeTab: "emails",
  expandedEmailId: "m1",
  fullBodyCache: new Map(),
  htmlBodyCache: new Map(),
  bodyViewMode: new Map()
});
assert.ok(expandedRichHtml.includes(`data-email-id="m1"`), "email rows must keep id hook");
assert.ok(expandedRichHtml.includes(`data-email-view="html"`), "rich/plain toggle must keep view hook");
assert.ok(expandedRichHtml.includes("inbox-item-body-html"), "expanded HTML email must default to rich iframe");

const expandedPlainHtml = view.renderInboxContentHtml({
  emails: [{
    id: "m2",
    subject: "Hello",
    bodyHtml: "<p>Rich</p>",
    bodyText: "Plain body"
  }]
}, {
  activeTab: "emails",
  expandedEmailId: "m2",
  fullBodyCache: new Map(),
  htmlBodyCache: new Map(),
  bodyViewMode: new Map([["m2", "text"]])
});
assert.ok(expandedPlainHtml.includes("<pre"), "plain mode must render text in a pre");
assert.ok(expandedPlainHtml.includes("Plain body"), "plain mode must show text body");
assert.ok(!expandedPlainHtml.includes("inbox-item-body-html"), "plain mode must not render rich iframe");

const plainOnlyHtml = view.renderInboxContentHtml({
  messages: [{ id: "m3", subject: "Plain only", bodyText: "Only text" }]
}, {
  activeTab: "emails",
  expandedEmailId: "m3"
});
assert.ok(plainOnlyHtml.includes("<pre"), "plain-only expanded email must render a pre");
assert.ok(!plainOnlyHtml.includes(`data-email-view="html"`), "plain-only email must not show rich toggle");

const noBodyHtml = view.renderInboxContentHtml({
  emails: [{ id: "m4", subject: "Empty" }]
}, {
  activeTab: "emails",
  expandedEmailId: "m4"
});
assert.ok(noBodyHtml.includes("（此邮件没有可预览的文本正文）"), "empty expanded email must keep existing Chinese empty state");

const calendarHtml = view.renderInboxContentHtml({
  events: [{ title: "Standup", location: "Room 1", start: "2026-05-04T12:00:00Z" }]
}, { activeTab: "calendar" });
assert.ok(calendarHtml.includes("inbox-item"), "calendar renderer must keep basic row markup");
assert.ok(calendarHtml.includes("Standup"), "calendar renderer must render event title");

assert.ok(consoleSource.includes(`from "./console-inbox-view.mjs"`), "console.js must import the pure inbox view module");
assert.ok(!/function\s+renderEmailHtmlFrame\b/.test(consoleSource), "console.js must not keep the email iframe renderer");
assert.ok(!consoleSource.includes(`class="inbox-item-body-html"`), "console.js must not keep rich email iframe markup");
assert.ok(!consoleSource.includes(`class="inbox-item"`), "console.js must not keep large inbox row HTML templates");
assert.ok(consoleSource.includes("_inboxState"), "console.js must keep inbox state");
assert.ok(consoleSource.includes("async function loadInboxTab"), "console.js must keep loadInboxTab controller");
assert.ok(consoleSource.includes("resourceCache"), "console.js must keep resource cache");
assert.ok(consoleSource.includes("/messages/${encodeURIComponent(id)}"), "console.js must keep full-body fetch");
assert.ok(consoleSource.includes("openExternal"), "console.js must keep external open binding");

assert.equal(pkg.scripts["verify:console-inbox-view"], "node scripts/verify-console-inbox-view.mjs");
assert.ok(CHECK_COMMANDS.includes("node scripts/verify-console-inbox-view.mjs"), "npm run check must include console inbox view verifier");

console.log("ok verify-console-inbox-view");
