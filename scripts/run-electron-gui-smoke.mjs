#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = Number(process.env.LINGXY_ELECTRON_GUI_SMOKE_TIMEOUT_MS ?? 30_000);
const smokeUserDataDir = path.join(os.tmpdir(), `lingxy-electron-gui-smoke-run-${process.pid}`);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function startSmokeService() {
  const requests = [];
  let branchSeq = 0;
  const now = () => new Date().toISOString();
  const conversations = new Map();
  const messagesByConversation = new Map();
  const seedConversationId = "gui-smoke-conv";
  conversations.set(seedConversationId, {
    conversation_id: seedConversationId,
    project_id: "gui-smoke-project",
    title: "GUI smoke conversation",
    created_at: now(),
    updated_at: now(),
    metadata: {}
  });
  messagesByConversation.set(seedConversationId, [
    {
      message_id: "gui-smoke-msg-user",
      conversation_id: seedConversationId,
      seq: 0,
      role: "user",
      content: "Create a GUI smoke branch from this prompt.",
      created_at: now(),
      metadata: {
        context_summary: {
          source_type: "manual",
          text_preview: "GUI smoke conversation branch source"
        }
      }
    },
    {
      message_id: "gui-smoke-msg-assistant",
      conversation_id: seedConversationId,
      seq: 1,
      role: "assistant",
      content: "Branch source answer.",
      created_at: now(),
      metadata: {}
    }
  ]);
  const listConversation = (conversation) => ({
    ...conversation,
    message_count: messagesByConversation.get(conversation.conversation_id)?.length ?? 0,
    task_count: 0,
    last_message_preview: messagesByConversation.get(conversation.conversation_id)?.at(-1)?.content ?? ""
  });
  const cloneMessageForBranch = (message, conversationId, seq) => ({
    ...message,
    conversation_id: conversationId,
    message_id: `${conversationId}-msg-${seq}`,
    seq,
    metadata: {
      ...(message.metadata ?? {}),
      branched_from: {
        conversation_id: message.conversation_id,
        message_id: message.message_id
      }
    }
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "electron-gui-smoke" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/tasks") {
      sendJson(response, 200, { tasks: [] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/conversations") {
      sendJson(response, 200, {
        conversations: [...conversations.values()].map(listConversation)
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/conversations/search") {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      const results = [...conversations.values()]
        .filter((conversation) => !query || `${conversation.title ?? ""} ${conversation.conversation_id}`.toLowerCase().includes(query))
        .map((conversation) => ({
          ...listConversation(conversation),
          match: query ? { field: "title", snippet: conversation.title ?? conversation.conversation_id } : null
        }));
      sendJson(response, 200, { results });
      return;
    }
    const conversationMatch = url.pathname.match(/^\/conversation\/([^/]+)$/u);
    if (request.method === "GET" && conversationMatch) {
      const conversationId = decodeURIComponent(conversationMatch[1]);
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        sendJson(response, 404, { error: "conversation_not_found" });
        return;
      }
      sendJson(response, 200, {
        conversation,
        messages: messagesByConversation.get(conversationId) ?? [],
        message_task_links: []
      });
      return;
    }
    const branchMatch = url.pathname.match(/^\/conversation\/([^/]+)\/(fork|rewind)$/u);
    if (request.method === "POST" && branchMatch) {
      const sourceConversationId = decodeURIComponent(branchMatch[1]);
      const mode = branchMatch[2];
      const sourceConversation = conversations.get(sourceConversationId);
      const sourceMessages = messagesByConversation.get(sourceConversationId) ?? [];
      if (!sourceConversation) {
        sendJson(response, 404, { error: "conversation_not_found" });
        return;
      }
      const body = await readBody(request);
      const throughMessageId = body.through_message_id ?? sourceMessages.at(-1)?.message_id;
      const throughIndex = Math.max(0, sourceMessages.findIndex((message) => message.message_id === throughMessageId));
      const branchId = body.conversation_id ?? `gui-smoke-branch-${++branchSeq}`;
      const copiedMessages = sourceMessages
        .slice(0, throughIndex + 1)
        .map((message, index) => cloneMessageForBranch(message, branchId, index));
      const conversation = {
        conversation_id: branchId,
        project_id: sourceConversation.project_id,
        title: `${sourceConversation.title} (${mode})`,
        created_at: now(),
        updated_at: now(),
        metadata: {
          branch: {
            kind: mode,
            source_conversation_id: sourceConversationId,
            through_message_id: throughMessageId
          }
        }
      };
      conversations.set(branchId, conversation);
      messagesByConversation.set(branchId, copiedMessages);
      requests.push({
        method: request.method,
        pathname: url.pathname,
        actor: request.headers["x-uca-actor"] ?? request.headers["x-lingxy-actor"] ?? null,
        body
      });
      sendJson(response, 200, {
        conversation,
        copied_messages: copiedMessages,
        branch: conversation.metadata.branch
      });
      return;
    }
    const editMatch = url.pathname.match(/^\/conversation\/([^/]+)\/messages\/([^/]+)\/edit$/u);
    if (request.method === "POST" && editMatch) {
      const sourceConversationId = decodeURIComponent(editMatch[1]);
      const messageId = decodeURIComponent(editMatch[2]);
      const sourceConversation = conversations.get(sourceConversationId);
      const sourceMessages = messagesByConversation.get(sourceConversationId) ?? [];
      if (!sourceConversation) {
        sendJson(response, 404, { error: "conversation_not_found" });
        return;
      }
      const targetIndex = sourceMessages.findIndex((message) => message.message_id === messageId);
      if (targetIndex < 0) {
        sendJson(response, 404, { error: "message_not_found" });
        return;
      }
      const body = await readBody(request);
      const branchId = body.conversation_id ?? `gui-smoke-branch-${++branchSeq}`;
      const copiedMessages = sourceMessages
        .slice(0, targetIndex)
        .map((message, index) => cloneMessageForBranch(message, branchId, index));
      const editedSource = sourceMessages[targetIndex];
      const editedMessage = {
        ...cloneMessageForBranch(editedSource, branchId, copiedMessages.length),
        content: String(body.content ?? "GUI smoke edited branch message"),
        metadata: {
          ...(editedSource.metadata ?? {}),
          edited_from: {
            conversation_id: editedSource.conversation_id,
            message_id: editedSource.message_id
          }
        }
      };
      copiedMessages.push(editedMessage);
      const conversation = {
        conversation_id: branchId,
        project_id: sourceConversation.project_id,
        title: `${sourceConversation.title} (edit)`,
        created_at: now(),
        updated_at: now(),
        metadata: {
          branch: {
            kind: "edit",
            source_conversation_id: sourceConversationId,
            edited_message_id: messageId
          }
        }
      };
      conversations.set(branchId, conversation);
      messagesByConversation.set(branchId, copiedMessages);
      requests.push({
        method: request.method,
        pathname: url.pathname,
        actor: request.headers["x-uca-actor"] ?? request.headers["x-lingxy-actor"] ?? null,
        body
      });
      sendJson(response, 200, {
        conversation,
        copied_messages: copiedMessages,
        edited_message: editedMessage,
        branch: conversation.metadata.branch
      });
      return;
    }
    const cancelMatch = url.pathname.match(/^\/task\/([^/]+)\/cancel$/u);
    if (request.method === "POST" && cancelMatch) {
      const body = await readBody(request);
      requests.push({
        method: request.method,
        pathname: url.pathname,
        actor: request.headers["x-uca-actor"] ?? request.headers["x-lingxy-actor"] ?? null,
        body
      });
      sendJson(response, 200, {
        task: {
          task_id: decodeURIComponent(cancelMatch[1]),
          status: "cancelled",
          cancel_requested: true,
          force: body.force === true
        }
      });
      return;
    }
    const retryMatch = url.pathname.match(/^\/task\/([^/]+)\/retry$/u);
    if (request.method === "POST" && retryMatch) {
      const body = await readBody(request);
      requests.push({
        method: request.method,
        pathname: url.pathname,
        actor: request.headers["x-uca-actor"] ?? request.headers["x-lingxy-actor"] ?? null,
        body
      });
      sendJson(response, 200, {
        task: {
          task_id: `${decodeURIComponent(retryMatch[1])}-retry`,
          parent_task_id: decodeURIComponent(retryMatch[1]),
          status: "queued",
          retry_mode: body.mode ?? "retry_same",
          background: body.background === true
        }
      });
      return;
    }
    sendJson(response, 404, { error: "smoke_service_route_not_found", pathname: url.pathname });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

const smokeService = await startSmokeService();
const env = {
  ...process.env,
  LINGXY_ELECTRON_GUI_SMOKE: "1",
  LINGXY_ELECTRON_GUI_SMOKE_USER_DATA_DIR: smokeUserDataDir,
  UCA_SERVICE_BASE_URL: process.env.LINGXY_ELECTRON_GUI_SMOKE_SERVICE_BASE_URL ?? smokeService.baseUrl
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [".", "--disable-gpu"], {
  cwd: repoRoot,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let stdout = "";
let stderr = "";
let settled = false;
let parsedResult = null;

function finish(error = null) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (!child.killed && child.exitCode == null) {
    child.kill();
  }
  smokeService.server.close(() => {});
  rm(smokeUserDataDir, { recursive: true, force: true }).catch(() => {});
  if (error) {
    console.error(stderr.trim() || stdout.trim() || error.message);
    process.exitCode = 1;
    return;
  }
  try {
    assert.equal(parsedResult?.ok, true, parsedResult?.error ?? "Electron GUI smoke failed");
    const checkNames = parsedResult.checks?.map((check) => check.name).join(", ") ?? "";
    console.log(`electron gui smoke ok${checkNames ? ` (${checkNames})` : ""}`);
  } catch (assertionError) {
    console.error(assertionError.message);
    process.exitCode = 1;
  }
}

function consumeStdout(chunk) {
  stdout += chunk;
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.match(/^LINGXY_GUI_SMOKE_RESULT\s+(.+)$/u);
    if (!match) continue;
    try {
      parsedResult = JSON.parse(match[1]);
      finish();
    } catch (error) {
      finish(error);
    }
  }
}

const timer = setTimeout(() => {
  finish(new Error(`Timed out waiting for Electron GUI smoke result after ${timeoutMs}ms`));
}, timeoutMs);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", consumeStdout);
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.on("error", finish);
child.on("exit", (code, signal) => {
  if (settled) return;
  finish(new Error(`Electron GUI smoke exited before result (code=${code}, signal=${signal ?? "none"})`));
});
