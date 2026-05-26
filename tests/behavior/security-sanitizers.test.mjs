import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeHtmlEntities,
  htmlMentionsHost,
  htmlToPlainText,
  sanitizeHtmlFragment,
  urlHostnameMatches
} from "../../src/service/security/html-utils.mjs";
import { sanitizeSvgMarkup } from "../../src/service/capabilities/tools/svg-sanitize.mjs";

test("HTML text extraction drops active content and avoids double entity decoding", () => {
  const text = htmlToPlainText("<p>Hello&nbsp;<script>bad()</script><b>world</b></p>");
  assert.equal(text.replace(/\s+/g, " ").trim(), "Hello world");
  assert.equal(decodeHtmlEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeHtmlEntities("&lt;"), "<");
});

test("HTML sanitizer removes active content and blocks dangerous URLs", () => {
  const html = sanitizeHtmlFragment('<a href="javascript:alert(1)" onclick="x()">x</a><script>bad()</script>');
  assert.equal(html, '<a href="#blocked">x</a>');
});

test("URL host checks match hostnames instead of unsafe substrings", () => {
  assert.equal(urlHostnameMatches("https://duckduckgo.com/path", "duckduckgo.com"), true);
  assert.equal(urlHostnameMatches("https://notduckduckgo.com/path", "duckduckgo.com"), false);
  assert.equal(htmlMentionsHost('<form action="//login.wappass.baidu.com/x"></form>', "wappass.baidu.com"), true);
});

test("SVG sanitizer removes active content and event attributes", () => {
  const svg = sanitizeSvgMarkup('<svg onload="x()"><script>bad()</script><a href="javascript:alert(1)"><text>ok</text></a></svg>');
  assert.match(svg, /^<svg/);
  assert.equal(svg.includes("script"), false);
  assert.equal(svg.includes("onload"), false);
  assert.equal(svg.includes("javascript:"), false);
});
