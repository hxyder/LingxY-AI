// UCA-181 follow-up:
//
// User scheduled "...发送邮件到 user-a@example.com和user-b@example.com"
// — only ONE recipient received the email. They had to re-fill the
// approval card to get the second one delivered.
//
// Root cause: the email-arg normaliser in
// connectors/tools/write-tools.mjs split on `[,;\s]+` only. The
// Chinese conjunction `和` was not a separator, so the LLM-emitted
// string "a@b.com和c@d.com" stayed as ONE token. Whether wrapped
// in an array or not, the recipient list had a single, malformed
// entry and Gmail delivered to a partial address.
//
// Framework fix: use email-shape extraction (find every @-bearing
// token in the string) instead of separator-based splitting.
// Falls back to the legacy splitter only when no @-bearing tokens
// are found, so the validator still reports clear "invalid email"
// errors. The same logic is mirrored in google-connector.mjs::asList
// for defense in depth.

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { ACCOUNT_SEND_EMAIL_TOOL } from "../src/service/capabilities/connectors/tools/write-tools.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

// We don't want to actually call Google. Stub the connector dispatcher
// by spying on what reaches the connector layer through a fake account
// and intercepting the inner sendGoogleEmail call.
//
// The cleanest approach: run normalizeEmailArgs through the public
// shape — by inspecting what the tool would have received. Easiest is
// to peek at the createWriteTool factory by simulating account
// resolution failure; the args printed BEFORE resolveAccount are what
// got normalized.
//
// The first cases snapshot the parser contract. Later cases exercise
// the public account_send_email tool with fake connected accounts and
// fetch stubs so the test verifies the actual production normalization
// path, not just a copied helper.

const EMAIL_LIKE_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
function extractEmailsFromMixedSeparator(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const trimmed = String(item ?? "").trim();
      if (!trimmed) continue;
      const matches = trimmed.match(EMAIL_LIKE_REGEX);
      if (matches?.length) out.push(...matches);
      else out.push(trimmed);
    }
    return [...new Set(out.map((v) => v.trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    const matches = value.match(EMAIL_LIKE_REGEX);
    if (matches?.length) return [...new Set(matches.map((v) => v.trim()).filter(Boolean))];
    return value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

// ---------------------------------------------------------------------
// 1. The exact bug repro: Chinese conjunction `和` between two emails.
// ---------------------------------------------------------------------
{
  const out = extractEmailsFromMixedSeparator("user-a@example.com和user-b@example.com");
  check("repro: '和' separates two emails",
    out.length === 2
    && out.includes("user-a@example.com")
    && out.includes("user-b@example.com"));
}

// ---------------------------------------------------------------------
// 2. LLM passes a single-element array containing the joined string
//    (the most likely real-world shape).
// ---------------------------------------------------------------------
{
  const out = extractEmailsFromMixedSeparator(["user-a@example.com和user-b@example.com"]);
  check("array-with-joined: single-element array still produces two recipients",
    out.length === 2);
}

// ---------------------------------------------------------------------
// 3. Other Chinese / English conjunctions.
// ---------------------------------------------------------------------
{
  const cases = [
    { input: "a@x.com 与 b@y.com", min: 2 },
    { input: "a@x.com、b@y.com、c@z.com", min: 3 },
    { input: "a@x.com 以及 b@y.com", min: 2 },
    { input: "a@x.com and b@y.com", min: 2 },
    { input: "a@x.com; b@y.com, c@z.com", min: 3 }
  ];
  for (const { input, min } of cases) {
    const out = extractEmailsFromMixedSeparator(input);
    check(`mixed-separator: '${input}' → ${min} recipients`,
      out.length === min);
  }
}

// ---------------------------------------------------------------------
// 4. Already-clean array passes through unchanged.
// ---------------------------------------------------------------------
{
  const out = extractEmailsFromMixedSeparator(["a@b.com", "c@d.com"]);
  check("clean-array: already-correct input is unchanged",
    out.length === 2 && out[0] === "a@b.com" && out[1] === "c@d.com");
}

// ---------------------------------------------------------------------
// 5. No @-bearing tokens → preserves legacy behaviour (split on punct).
// ---------------------------------------------------------------------
{
  const out = extractEmailsFromMixedSeparator("not, a, valid, email");
  check("no-email: falls back to legacy splitter so validator can report invalid",
    out.length === 4);
}

// ---------------------------------------------------------------------
// 6. Empty / null / undefined.
// ---------------------------------------------------------------------
{
  check("empty-string: empty list", extractEmailsFromMixedSeparator("").length === 0);
  check("empty-array: empty list", extractEmailsFromMixedSeparator([]).length === 0);
}

// ---------------------------------------------------------------------
// 7. Display name + bracket form is preserved as a single email.
//    (Optional behaviour — we extract just the @-bearing core.)
// ---------------------------------------------------------------------
{
  const out = extractEmailsFromMixedSeparator("Han <user-a@example.com>, Sophie <user-b@example.com>");
  check("display-name: both core addresses extracted",
    out.length === 2
    && out.includes("user-a@example.com")
    && out.includes("user-b@example.com"));
}

// ---------------------------------------------------------------------
// 8. Defensive: dedupe identical addresses.
// ---------------------------------------------------------------------
{
  const out = extractEmailsFromMixedSeparator("a@b.com, a@b.com");
  check("dedupe: identical entries collapse to one", out.length === 1);
}

// ---------------------------------------------------------------------
// 9. Spec-level: the action tool's spec still has flexible schema
//    that allows arrays / strings (the schema doesn't validate the
//    splitter — that's runtime).
// ---------------------------------------------------------------------
{
  const props = ACCOUNT_SEND_EMAIL_TOOL.parameters?.properties ?? {};
  check("spec: account_send_email schema still accepts a flexible to field",
    props.to !== undefined);
}

function createRuntimeWithAccounts(accounts) {
  const tokenMap = new Map(accounts.map((account) => [
    account.id,
    {
      accountId: account.id,
      accessToken: `token_${account.id}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    }
  ]));
  return {
    store: {
      listConnectedAccounts: () => accounts,
      getConnectedAccount: (id) => accounts.find((account) => account.id === id) ?? null,
      upsertConnectedAccount: (account) => {
        const index = accounts.findIndex((item) => item.id === account.id);
        if (index >= 0) accounts[index] = account;
        else accounts.push(account);
        return account;
      },
      getOAuthToken: (id) => tokenMap.get(id) ?? null,
      upsertOAuthToken: (record) => {
        tokenMap.set(record.accountId, record);
        return record;
      }
    }
  };
}

function decodeGmailRaw(raw) {
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

// ---------------------------------------------------------------------
// 10. Real tool path: account_send_email should normalize recipients
//     before the connector call, and accountId fallback should work.
// ---------------------------------------------------------------------
{
  const runtime = createRuntimeWithAccounts([{
    id: "acc_google",
    provider: "google",
    email: "user@gmail.com",
    userId: "local",
    tokenStatus: "active",
    capabilities: { emailWrite: true },
    scopes: ["https://www.googleapis.com/auth/gmail.send"]
  }]);
  let rawMessage = "";
  const fetchImpl = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    rawMessage = decodeGmailRaw(body.raw);
    return { ok: true, json: async () => ({ id: "msg_two_recipients" }) };
  };
  const result = await ACCOUNT_SEND_EMAIL_TOOL.execute({
    accountId: "google user@gmail.com",
    provider: "google",
    to: "user-a@example.com和user-b@example.com",
    subject: "x",
    body: "y"
  }, { runtime, fetchImpl, task: { user_command: "send" } });
  check("real-tool: Gmail send succeeds with malformed accountId + 和-separated recipients",
    result.success === true);
  check("real-tool: Gmail To header contains both recipients",
    /^To: user-a@example\.com, user-b@example\.com/m.test(rawMessage));
}

{
  const runtime = createRuntimeWithAccounts([{
    id: "acc_ms",
    provider: "microsoft",
    email: "user@outlook.com",
    userId: "local",
    tokenStatus: "active",
    capabilities: { emailWrite: true },
    scopes: ["Mail.Send"]
  }]);
  let payload = null;
  const fetchImpl = async (_url, init = {}) => {
    payload = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) };
  };
  const result = await ACCOUNT_SEND_EMAIL_TOOL.execute({
    accountId: "Microsoft: user@outlook.com",
    provider: "microsoft",
    to: "user-a@example.com/user-b@example.com",
    subject: "x",
    body: "y"
  }, { runtime, fetchImpl, task: { user_command: "send" } });
  const addresses = payload?.message?.toRecipients?.map((item) => item.emailAddress.address) ?? [];
  check("real-tool: Outlook send succeeds with slash-separated recipients",
    result.success === true);
  check("real-tool: Outlook payload contains both recipients",
    addresses.length === 2 && addresses.includes("user-a@example.com") && addresses.includes("user-b@example.com"));
}

{
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-email-attach-"));
  try {
    const attachmentPath = path.join(tempDir, "report-user-a@example.com.txt");
    await writeFile(attachmentPath, "attachment body", "utf8");
    const runtime = createRuntimeWithAccounts([{
      id: "acc_google_attach",
      provider: "google",
      email: "user@gmail.com",
      userId: "local",
      tokenStatus: "active",
      capabilities: { emailWrite: true },
      scopes: ["https://www.googleapis.com/auth/gmail.send"]
    }]);
    let rawMessage = "";
    const fetchImpl = async (_url, init = {}) => {
      const body = JSON.parse(init.body);
      rawMessage = decodeGmailRaw(body.raw);
      return { ok: true, json: async () => ({ id: "msg_attachment" }) };
    };
    const result = await ACCOUNT_SEND_EMAIL_TOOL.execute({
      accountId: "user@gmail.com",
      provider: "google",
      to: "recipient@example.com",
      subject: "x",
      body: "y",
      attachmentPaths: [attachmentPath]
    }, { runtime, fetchImpl, task: { user_command: "send attachment" } });
    check("real-tool: Gmail attachment path containing @ is not mistaken for an email",
      result.success === true && /report-user-a@example\.com\.txt/.test(rawMessage));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------
// 11. Override-merge shape: the framework merges overrides at the
//     correct level based on the approval's proposed_action.
//     User repro: edited `to` in approval card, but only first
//     recipient received the email — overrides were going into
//     args.input.to while the tool reads args.to.
// ---------------------------------------------------------------------
{
  const { createPendingApprovalService } = await import("../src/service/scheduler/pending-approvals.mjs");

  // Stub store for the approval service.
  function createMockStore() {
    const approvals = new Map();
    return {
      listPendingApprovals() { return [...approvals.values()]; },
      getPendingApproval(id) { return approvals.get(id) ?? null; },
      appendPendingApproval(record) { approvals.set(record.approval_id, { ...record }); },
      updatePendingApproval(id, patch) {
        const a = approvals.get(id);
        if (!a) return null;
        const updated = { ...a, ...patch };
        approvals.set(id, updated);
        return updated;
      },
      insertTask: () => {},
      getTask: () => null,
      updateTask: () => {},
      appendEvent: () => {},
      appendAuditLog: () => {},
      updateScheduleRun: () => {},
      getTaskEvents: () => []
    };
  }

  // 10a. agent_tool_call → overrides merge at TOP level.
  {
    const runtime = {
      store: createMockStore(),
      eventBus: { publish: () => {} }
    };
    let capturedActionParams = null;
    runtime.pendingApprovals = createPendingApprovalService({
      runtime,
      executeApprovedAction: async (approval, { overrides } = {}) => {
        // Mirror engine.mjs's merge logic exactly so the unit test
        // exercises the same branch.
        let actionParams = approval.proposed_params;
        if (overrides && typeof overrides === "object" && Object.keys(overrides).length > 0) {
          if (approval.proposed_action === "connector_workflow") {
            actionParams = {
              ...actionParams,
              input: { ...(actionParams?.input ?? {}), ...overrides }
            };
          } else {
            actionParams = { ...actionParams, ...overrides };
          }
        }
        capturedActionParams = actionParams;
        return { task: { task_id: "t_resume", status: "success" } };
      }
    });
    const approval = runtime.pendingApprovals.create({
      sourceType: "agent_tool_call",
      sourceId: "task_orig",
      proposedAction: "action_tool",
      proposedTarget: "account_send_email",
      proposedParams: {
        to: ["user-a@example.com"],
        subject: "Stock summary",
        body: "..."
      },
      previewText: "send email"
    });
    await runtime.pendingApprovals.approve(approval.approval_id, {
      overrides: { to: "user-a@example.com, user-b@example.com" }
    });
    check("override-merge: agent_tool_call → edited `to` lands at args.to (top level)",
      capturedActionParams?.to === "user-a@example.com, user-b@example.com");
    check("override-merge: agent_tool_call → does NOT bury override in args.input",
      !capturedActionParams?.input);
  }

  // 10b. connector_workflow → overrides merge inside `input` (legacy).
  {
    const runtime = {
      store: createMockStore(),
      eventBus: { publish: () => {} }
    };
    let capturedActionParams = null;
    runtime.pendingApprovals = createPendingApprovalService({
      runtime,
      executeApprovedAction: async (approval, { overrides } = {}) => {
        let actionParams = approval.proposed_params;
        if (overrides && typeof overrides === "object" && Object.keys(overrides).length > 0) {
          if (approval.proposed_action === "connector_workflow") {
            actionParams = {
              ...actionParams,
              input: { ...(actionParams?.input ?? {}), ...overrides }
            };
          } else {
            actionParams = { ...actionParams, ...overrides };
          }
        }
        capturedActionParams = actionParams;
        return { task: { task_id: "t_resume", status: "success" } };
      }
    });
    const approval = runtime.pendingApprovals.create({
      sourceType: "connector_workflow",
      sourceId: "task_orig:wf:step",
      proposedAction: "connector_workflow",
      proposedTarget: "google.gmail.draft_confirm_send",
      proposedParams: {
        input: { to: ["user-a@example.com"], subject: "x", body: "y" },
        state: { confirmation: { approved: true } }
      },
      previewText: "send via workflow"
    });
    await runtime.pendingApprovals.approve(approval.approval_id, {
      overrides: { to: "user-a@example.com, user-b@example.com" }
    });
    check("override-merge: connector_workflow → edited `to` still merges into args.input.to",
      capturedActionParams?.input?.to === "user-a@example.com, user-b@example.com");
    check("override-merge: connector_workflow → state is preserved",
      capturedActionParams?.state?.confirmation?.approved === true);
  }
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
