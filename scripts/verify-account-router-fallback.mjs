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

// ---------------------------------------------------------------------
// 5. Forgiving accountId match — LLM keeps emitting variations of the
//    error message it just saw. All these should resolve to the
//    matching account by extracting the @-bearing email token.
// ---------------------------------------------------------------------
{
  const variants = [
    "google hxy94045@gmail.com",         // bug repro: provider + space + email
    "google/hxy94045@gmail.com",         // forward slash
    "Google: hxy94045@gmail.com",        // colon + uppercase
    "hxy94045@gmail.com (google)",       // email + parenthesised provider
    "  hxy94045@gmail.com  ",            // pure email with whitespace
    "<hxy94045@gmail.com>"               // angle brackets
  ];
  const accountsWithBugRepro = [{
    id: "acc_real_001",
    accountId: "acc_real_001",
    provider: "google",
    email: "hxy94045@gmail.com",
    tokenStatus: "active",
    capabilities: { emailWrite: true }
  }];
  for (const variant of variants) {
    const result = resolveAccount(
      { connectedAccounts: accountsWithBugRepro },
      { accountId: variant },
      "emailWrite"
    );
    check(`forgiving-match: '${variant}' resolves to the real account`,
      result.status !== "error" && result.id === "acc_real_001");
  }
}

// ---------------------------------------------------------------------
// 6. Email format in error message: the message renders the email
//    PRIMARILY (not provider/email), so when the LLM copies the
//    suggested format it gets back a usable accountId.
// ---------------------------------------------------------------------
{
  const result = resolveAccount(
    { connectedAccounts: accounts },
    { accountId: "default" },
    "emailWrite"
  );
  check("format: message lists each account as 'email (provider)'",
    /user@gmail\.com\s*\(google\)/i.test(result.message)
    && /user@outlook\.com\s*\(microsoft\)/i.test(result.message));
  check("format: message does NOT use the old slash form (google/email)",
    !/google\/user@gmail\.com/.test(result.message));
}

// ---------------------------------------------------------------------
// 7. Truly garbage accountId still errors out — the forgiving matcher
//    only kicks in when there's an @-bearing token to extract.
// ---------------------------------------------------------------------
{
  const result = resolveAccount(
    { connectedAccounts: accounts },
    { accountId: "primary" },
    "emailWrite"
  );
  check("garbage: 'primary' (no email pattern) still errors out",
    result.status === "error");
  check("garbage: error preserves the structured availableAccounts",
    Array.isArray(result.availableAccounts) && result.availableAccounts.length === 2);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
