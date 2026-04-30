import assert from "node:assert/strict";
import {
  applySideEffectContractToToolArgs,
  buildSideEffectContract,
  extractSideEffectEntities,
  inferSideEffectPolicyGroups
} from "../src/service/core/policy/side-effect-contracts.mjs";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { runConnectorWorkflow } from "../src/service/connectors/core/workflow-dispatcher.mjs";

let pass = 0;
function check(label, condition) {
  assert.equal(Boolean(condition), true, label);
  pass += 1;
  process.stdout.write(`PASS  ${label}\n`);
}

const runtime = {
  store: {
    listConnectedAccounts: () => [{
      id: "acct_google",
      provider: "google",
      email: "hxy94045@gmail.com",
      tokenStatus: "active"
    }]
  }
};

const scheduledTask = {
  user_command: "整理今天新闻后发送邮件到 user-a@example.com",
  context_packet: {
    text: "整理今天新闻后发送邮件到 user-a@example.com",
    selection_metadata: {
      schedule_name: "Scheduled:整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com",
      schedule_description: "通过我连接的 Google 账号 hxy94045@gmail.com 发送",
      schedule_action_target: "整理今天新闻后发送邮件"
    },
    file_paths: []
  }
};

const entities = extractSideEffectEntities({ task: scheduledTask, runtime });
check("entities: connected account email is marked as account_identity",
  entities.some((e) => e.value === "hxy94045@gmail.com" && e.roles.includes("account_identity")));
check("entities: recipient emails are external identities",
  entities.filter((e) => e.kind === "email_address" && e.roles.includes("external_identity")).length === 2);

const inferredEmailGroups = inferSideEffectPolicyGroups({
  runtime,
  sources: ["整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com"]
});
check("intent fallback: clear email send request infers email_send",
  inferredEmailGroups.includes("email_send"));
check("intent fallback: instructional email question is not an execution obligation",
  !inferSideEffectPolicyGroups({
    runtime,
    sources: ["如何发送邮件到 user-a@example.com"]
  }).includes("email_send"));
check("intent fallback: calendar create request infers calendar_create",
  inferSideEffectPolicyGroups({
    sources: ["安排明天下午 30 分钟 meeting"]
  }).includes("calendar_create"));
check("intent fallback: file upload requires an attached/local file slot",
  inferSideEffectPolicyGroups({
    task: {
      user_command: "上传这个文件到 Google Drive",
      context_packet: { file_paths: ["C:\\Users\\der\\Desktop\\report.pdf"] }
    }
  }).includes("file_upload"));

const emailArgs = applySideEffectContractToToolArgs("connector_workflow_run", {
  workflowId: "google.gmail.draft_confirm_send",
  input: {
    to: "user-a@example.com",
    subject: "x",
    body: "y"
  }
}, { task: scheduledTask, runtime });
check("email_send: workflow input preserves both requested recipients",
  emailArgs.input.to.length === 2
    && emailArgs.input.to.includes("user-a@example.com")
    && emailArgs.input.to.includes("user-b@example.com"));
check("email_send: connected account identity is not copied into recipients",
  !emailArgs.input.to.includes("hxy94045@gmail.com"));

const calendarArgs = applySideEffectContractToToolArgs("account_create_event", {
  title: "Review",
  startTime: "2026-04-30T13:00:00-04:00",
  endTime: "2026-04-30T13:30:00-04:00",
  attendees: ["user-a@example.com"]
}, {
  task: {
    user_command: "创建会议，邀请 user-a@example.com 和 user-b@example.com",
    task_spec: {
      success_contract: { required_policy_groups: ["calendar_create"] }
    }
  },
  runtime
});
check("calendar_create: attendees use the same side-effect slot preservation",
  calendarArgs.attendees.length === 2
    && calendarArgs.attendees.includes("user-a@example.com")
    && calendarArgs.attendees.includes("user-b@example.com"));

const fileArgs = applySideEffectContractToToolArgs("account_upload_file", {
  folderId: "root"
}, {
  task: {
    user_command: "上传这个文件到 Drive",
    task_spec: {
      success_contract: { required_policy_groups: ["file_upload"] }
    },
    context_packet: {
      file_paths: ["C:\\Users\\der\\Desktop\\report.pdf"]
    }
  },
  runtime
});
check("file_upload: localPath fills from attached file path when missing",
  fileArgs.localPath === "C:\\Users\\der\\Desktop\\report.pdf");

const persisted = buildSideEffectContract({
  policyGroups: ["email_send", "calendar_create", "file_upload"],
  runtime,
  sources: [
    "发送到 user-a@example.com 和 user-b@example.com",
    "C:\\Users\\der\\Desktop\\report.pdf"
  ]
});
check("contract registry: can persist multiple side-effect groups",
  Boolean(persisted.groups.email_send)
    && Boolean(persisted.groups.calendar_create)
    && Boolean(persisted.groups.file_upload));

const inferredPersisted = buildSideEffectContract({
  inferPolicyGroups: true,
  runtime,
  sources: ["整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com"]
});
check("contract registry: inferred side-effect contract preserves recipients without SR",
  inferredPersisted.groups.email_send.slots.to.values.length === 2);

{
  const { runtime: workflowRuntime } = createServiceBootstrap();
  const now = new Date().toISOString();
  workflowRuntime.store.upsertConnectedAccount({
    id: "acct_google",
    userId: "local",
    provider: "google",
    providerAccountId: "hxy94045",
    email: "hxy94045@gmail.com",
    displayName: "HXY",
    capabilities: { emailWrite: true },
    scopes: [],
    tokenStatus: "active",
    createdAt: now,
    updatedAt: now
  });
  const result = await runConnectorWorkflow({
    runtime: workflowRuntime,
    workflowId: "google.gmail.draft_confirm_send",
    input: {
      to: "user-a@example.com",
      subject: "x",
      body: "y"
    },
    task: scheduledTask,
    emitTaskEvent: () => {}
  });
  const to = result.approval?.proposed_params?.input?.to ?? [];
  check("workflow path: approval proposal receives preserved side-effect recipients",
    result.status === "waiting_external_decision"
      && to.length === 2
      && to.includes("user-a@example.com")
      && to.includes("user-b@example.com"));
}

process.stdout.write(`\n${pass} pass / 0 fail\n`);
