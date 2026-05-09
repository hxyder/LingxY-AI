#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import {
  searchConversationHistory
} from "../src/service/core/http-routes/note-project-conversation-routes.mjs";
import {
  searchConversations
} from "../src/desktop/renderer/conversation-cache.mjs";
import {
  renderChatSidebarListHtml
} from "../src/desktop/renderer/console-chat-sidebar.mjs";

const store = createInMemoryStoreScaffold();
const convA = store.insertConversation({
  conversation_id: "conv_analyst",
  project_id: "proj_jobs",
  title: "Analyst roles"
});
const convB = store.insertConversation({
  conversation_id: "conv_recipe",
  project_id: "proj_home",
  title: "Dinner ideas"
});

store.appendMessage({
  conversation_id: convA.conversation_id,
  role: "user",
  content: "帮我整理 analyst 岗位链接",
  metadata: {
    context_summary: {
      source_type: "browser_page",
      title: "LinkedIn analyst search",
      url: "https://www.linkedin.com/jobs/search/?keywords=analyst",
      text_preview: "Oracle Functional Analyst, Compensation Analyst",
      file_paths: ["E:\\linxiDoc\\jobs.csv"]
    }
  }
});
store.appendMessage({
  conversation_id: convA.conversation_id,
  role: "assistant",
  content: "已整理岗位来源。"
});
store.appendMessage({
  conversation_id: convB.conversation_id,
  role: "user",
  content: "今晚吃什么？"
});

{
  const results = searchConversationHistory({ store, query: "Compensation Analyst", limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].conversation_id, "conv_analyst");
  assert.equal(results[0].match.role, "user");
  assert.match(results[0].match.snippet, /Compensation Analyst/);
  assert.equal(results[0].match.context_summary.url, "https://www.linkedin.com/jobs/search/?keywords=analyst");
}

{
  const results = searchConversationHistory({ store, query: "analyst", projectId: "proj_home", limit: 5 });
  assert.equal(results.length, 0, "project filter must not leak conversations from other projects");
}

{
  const results = searchConversationHistory({ store, query: "Dinner", limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].conversation_id, "conv_recipe");
}

{
  assert.deepEqual(searchConversationHistory({ store, query: "   " }), []);
}

const routeSource = readFileSync(new URL("../src/service/core/http-routes/note-project-conversation-routes.mjs", import.meta.url), "utf8");
assert.match(routeSource, /url\.pathname === "\/conversations\/search"/u);
assert.match(routeSource, /searchConversationHistory\(\{/u);

{
  const rows = await searchConversations(async (url) => {
    assert.match(url, /\/conversations\/search\?/);
    assert.match(url, /q=Compensation\+Analyst/);
    assert.match(url, /project_id=proj_jobs/);
    return {
      ok: true,
      async json() {
        return {
          results: [{
            conversation_id: "conv_analyst",
            title: "Analyst roles",
            updated_at: "2026-05-08T00:00:00.000Z",
            message_count: 2,
            task_count: 1,
            match: {
              snippet: "Oracle Functional Analyst, Compensation Analyst",
              role: "user"
            }
          }]
        };
      }
    };
  }, "http://127.0.0.1:4310", {
    query: "Compensation Analyst",
    projectId: "proj_jobs"
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].conversation_id, "conv_analyst");
  assert.match(rows[0].search_match.snippet, /Compensation Analyst/);

  const html = renderChatSidebarListHtml({
    items: rows,
    searchTerm: "Compensation Analyst",
    searchAlreadyApplied: true
  });
  assert.match(html, /Compensation Analyst/);
  assert.match(html, /data-chat-sidebar-id="conv_analyst"/);
}

const consoleSource = readFileSync(new URL("../src/desktop/renderer/console.js", import.meta.url), "utf8");
assert.match(consoleSource, /searchConversations\s+as\s+cacheSearchConversations/u);
assert.match(consoleSource, /refreshChatSidebar\(\{\s*force:\s*true\s*\}\)/u);

console.log("conversation search contract ok");
