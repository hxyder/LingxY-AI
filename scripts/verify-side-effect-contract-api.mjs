#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { createServiceHttpServer } from "../src/service/core/http-server.mjs";
import { applySideEffectContractToToolArgs } from "../src/service/core/policy/side-effect-contracts.mjs";

let pass = 0;
let fail = 0;

async function it(label, fn) {
  try {
    await fn();
    pass += 1;
    process.stdout.write(`PASS  ${label}\n`);
  } catch (error) {
    fail += 1;
    process.stdout.write(`FAIL  ${label}\n  ${error?.message ?? error}\n`);
  }
}

async function startApi() {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-side-effect-api-"));
  const paths = {
    dataDir: dir,
    logsDir: path.join(dir, "logs"),
    previewCacheDir: path.join(dir, "preview-cache")
  };
  const { runtime } = createServiceBootstrap({ paths });
  const { server } = createServiceHttpServer({ runtime, paths });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    runtime,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.close(() => {
        rmSync(dir, { recursive: true, force: true });
        resolve();
      });
    })
  };
}

async function fetchJson(url, opts = {}) {
  const response = await fetch(url, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function json(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function scheduledTaskFromSchedule(schedule) {
  return {
    user_command: schedule.action_params?.userCommand ?? schedule.action_target,
    context_packet: {
      text: [
        schedule.name,
        schedule.description,
        schedule.action_target,
        schedule.action_params?.userCommand,
        schedule.action_params?.contextText
      ].filter(Boolean).join("\n"),
      selection_metadata: {
        schedule_name: schedule.name,
        schedule_description: schedule.description,
        schedule_action_target: schedule.action_target,
        side_effect_contract: schedule.metadata?.side_effect_contract ?? null
      }
    }
  };
}

function createTaskScheduleBody({ name, command }) {
  return {
    name,
    description: "原始指令：" + command,
    trigger: {
      type: "cron",
      expression: "*/5 * * * *",
      timezone: "America/New_York"
    },
    action: {
      type: "task",
      target: command.slice(0, 120),
      params: {
        userCommand: command,
        contextText: command
      }
    },
    executionMode: "interactive",
    category: "email"
  };
}

await it("HTTP PATCH /schedules updates the real task payload, not only the display name", async () => {
  const api = await startApi();
  try {
    const oldCommand = "整理今天新闻后发送邮件到 user-a@example.com";
    const newCommand = "整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com";
    const created = await fetchJson(`${api.url}/schedules`, json("POST", createTaskScheduleBody({
      name: "Scheduled:" + oldCommand,
      command: oldCommand
    })));
    assert.equal(created.status, 200);
    const scheduleId = created.body.schedule.schedule_id;

    const patched = await fetchJson(`${api.url}/schedules/${encodeURIComponent(scheduleId)}`, json("PATCH", {
      name: "Scheduled:" + newCommand,
      description: "原始指令：" + newCommand,
      userCommand: newCommand
    }));
    assert.equal(patched.status, 200);

    const schedule = patched.body.schedule;
    assert.equal(schedule.action_params.userCommand, newCommand);
    assert.match(schedule.action_target, /sophieliang1998@gmail\.com/);

    const listed = await fetchJson(`${api.url}/schedules`);
    assert.equal(listed.status, 200);
    const saved = listed.body.schedules.find((item) => item.schedule_id === scheduleId);
    assert.equal(saved.action_params.userCommand, newCommand);
    assert.match(saved.action_target, /sophieliang1998@gmail\.com/);
  } finally {
    await api.close();
  }
});

await it("schedule metadata participates in generic side-effect slot preservation", async () => {
  const api = await startApi();
  try {
    api.runtime.store.upsertConnectedAccount({
      id: "acct_google",
      userId: "local",
      provider: "google",
      providerAccountId: "hxy94045",
      email: "hxy94045@gmail.com",
      displayName: "HXY",
      capabilities: { emailWrite: true },
      scopes: [],
      tokenStatus: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const payloadCommand = "整理今天新闻后发送邮件到 user-a@example.com";
    const displayCommand = "整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com";
    const created = await fetchJson(`${api.url}/schedules`, json("POST", createTaskScheduleBody({
      name: "Scheduled:" + displayCommand,
      command: payloadCommand
    })));
    assert.equal(created.status, 200);

    const task = scheduledTaskFromSchedule(created.body.schedule);
    const args = applySideEffectContractToToolArgs("connector_workflow_run", {
      workflowId: "google.gmail.draft_confirm_send",
      input: {
        to: "user-a@example.com",
        subject: "今日新闻",
        body: "..."
      }
    }, { task, runtime: api.runtime });

    assert.deepEqual(args.input.to, [
      "user-a@example.com",
      "user-b@example.com"
    ]);
  } finally {
    await api.close();
  }
});

await it("schedule edit makes the side-effect contract authoritative", async () => {
  const api = await startApi();
  try {
    const oldCommand = "整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com";
    const newCommand = "整理今天新闻后发送邮件到 user-a@example.com";
    const created = await fetchJson(`${api.url}/schedules`, json("POST", createTaskScheduleBody({
      name: "Scheduled:" + oldCommand,
      command: oldCommand
    })));
    assert.equal(created.status, 200);
    const scheduleId = created.body.schedule.schedule_id;

    const patched = await fetchJson(`${api.url}/schedules/${encodeURIComponent(scheduleId)}`, json("PATCH", {
      userCommand: newCommand
    }));
    assert.equal(patched.status, 200);

    const task = scheduledTaskFromSchedule(patched.body.schedule);
    const args = applySideEffectContractToToolArgs("connector_workflow_run", {
      workflowId: "google.gmail.draft_confirm_send",
      input: {
        to: "user-a@example.com",
        subject: "今日新闻",
        body: "..."
      }
    }, { task, runtime: api.runtime });

    assert.deepEqual(args.input.to, [
      "user-a@example.com"
    ], "stale display-name recipients must not be reintroduced after editing the action payload");
  } finally {
    await api.close();
  }
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
