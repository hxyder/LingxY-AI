// UCA-181 follow-up: account-router error message must surface the list
// of valid accountIds so a hallucinating LLM can self-correct on the
// next turn instead of dead-ending at "指定账户不存在或不可用。".
//
// Repro: agent calls account_send_email with `accountId: "default"` (a
// hallucinated string) on a workspace that has one connected Gmail
// account. Old behavior returned a terse error and the agent kept
// retrying with the same fake accountId. The new error includes the
// real account list AND a hint that the field can be omitted.

import assert from "node:assert/strict";

import { resolveAccount } from "../src/service/connectors/core/account-router.mjs";

const accounts = [
  {
    id: "acc_gmail_real",
    accountId: "acc_gmail_real",
    provider: "google",
    email: "user@gmail.com",
    tokenStatus: "active",
    capabilities: { emailWrite: true, calendarWrite: true }
  },
  {
    id: "acc_outlook_real",
    accountId: "acc_outlook_real",
    provider: "microsoft",
    email: "user@outlook.com",
    tokenStatus: "active",
    capabilities: { emailWrite: true }
  }
];

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

// ---------------------------------------------------------------------
// 1. Hallucinated accountId returns a structured error with the list.
// ---------------------------------------------------------------------
{
  const result = resolveAccount(
    { connectedAccounts: accounts },
    { accountId: "default" },
    "emailWrite"
  );
  check("error: status is 'error'", result.status === "error");
  check("error: errorCode is ACCOUNT_NOT_FOUND", result.errorCode === "ACCOUNT_NOT_FOUND");
  check("error: message names the bad accountId", /default/.test(result.message));
  check("error: message lists viable accounts", /user@gmail\.com|user@outlook\.com/.test(result.message));
  check("error: message hints that accountId can be omitted",
    /可省略|optional|omit/i.test(result.message) || /自动选择/.test(result.message));
  check("error: structured availableAccounts is included",
    Array.isArray(result.availableAccounts) && result.availableAccounts.length === 2);
  check("error: availableAccounts entries carry provider+email",
    result.availableAccounts.every((a) => a.provider && (a.email || a.accountId)));
}

// ---------------------------------------------------------------------
// 2. Empty accountId → resolver auto-resolves (no regression).
// ---------------------------------------------------------------------
{
  const result = resolveAccount(
    { connectedAccounts: accounts, userUtterance: "send email via Gmail" },
    {},
    "emailWrite"
  );
  check("auto: returns a real account, not an error", result.status !== "error");
  check("auto: picked one of the real accounts",
    result.id === "acc_gmail_real" || result.id === "acc_outlook_real");
}

// ---------------------------------------------------------------------
// 3. Valid accountId → resolver returns it (no regression).
// ---------------------------------------------------------------------
{
  const result = resolveAccount(
    { connectedAccounts: accounts },
    { accountId: "acc_gmail_real" },
    "emailWrite"
  );
  check("valid: real accountId resolves to the matching account",
    result.id === "acc_gmail_real" && result.email === "user@gmail.com");
}

// ---------------------------------------------------------------------
// 4. No accounts connected → message tells the user to connect one.
// ---------------------------------------------------------------------
{
  const result = resolveAccount(
    { connectedAccounts: [] },
    { accountId: "anything" },
    "emailWrite"
  );
  check("empty: error names the missing connection (Gmail/Outlook)",
    /Gmail|Outlook|连接/i.test(result.message));
  check("empty: availableAccounts is the empty array, not undefined",
    Array.isArray(result.availableAccounts) && result.availableAccounts.length === 0);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
