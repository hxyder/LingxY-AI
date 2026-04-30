import { createCapabilityMap } from "./types.mjs";
import { buildReauthRequired } from "./reauth-manager.mjs";

export function inferPreferredProvider(text = "") {
  const value = String(text ?? "").toLowerCase();
  if (/(gmail|google drive|google calendar|谷歌|google)/i.test(value)) return "google";
  if (/(outlook|onedrive|microsoft|office 365|teams|微软)/i.test(value)) return "microsoft";
  return null;
}

export function capabilityToPurpose(capability) {
  if (String(capability).startsWith("email")) return "email";
  if (String(capability).startsWith("file")) return "files";
  if (String(capability).startsWith("calendar")) return "calendar";
  return null;
}

function isDefaultForPurpose(account, purpose) {
  if (purpose === "email") return account.isDefaultForEmail === true;
  if (purpose === "files") return account.isDefaultForFiles === true;
  if (purpose === "calendar") return account.isDefaultForCalendar === true;
  return false;
}

function candidateView(account) {
  return {
    accountId: account.id,
    provider: account.provider,
    email: account.email
  };
}

function sameText(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

// UCA-181 follow-up: the LLM frequently emits malformed accountIds that
// it copy-pasted from prior error messages or reasoned by analogy:
//   "google hxy94045@gmail.com"  (provider + space + email)
//   "google/hxy94045@gmail.com"  (the format the error listed)
//   "Google: hxy94045@gmail.com"
//   "hxy94045@gmail.com (google)"
// Strict equality misses every one. Extract the @-bearing email token
// from the candidate string and try matching by that — the email
// itself is a globally unique identifier inside our account list.
// Conservative local-part charset (\w means [A-Za-z0-9_], plus
// `.` `+` `-`). RFC 5322 technically allows `/` and other
// punctuation, but accepting them lets a human-readable separator
// like "google/hxy94045@gmail.com" be misread as a single email
// token. Real-world Gmail/Outlook addresses use the conservative
// subset, so we trade RFC purity for separator robustness.
const EMAIL_LIKE_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function extractEmailToken(value) {
  if (!value) return null;
  const match = String(value).match(EMAIL_LIKE_REGEX);
  return match ? match[0].trim().toLowerCase() : null;
}

function matchesAccountIdentity(account, value) {
  if (!value) return false;
  if (sameText(account.id, value)
    || sameText(account.accountId, value)
    || sameText(account.email, value)
    || sameText(account.providerAccountId, value)
    || sameText(account.displayName, value)) {
    return true;
  }
  // Forgiving fallback: pull the email out of the candidate, compare
  // against the account's email. Avoids dead-ending the LLM on
  // "google hxy94045@gmail.com"-style typos. Only matches when the
  // account has a usable email (the strict path already covered the
  // id-only case).
  const emailToken = extractEmailToken(value);
  if (emailToken && account.email && sameText(account.email, emailToken)) {
    return true;
  }
  return false;
}

export function resolveAccount(ctx, input = {}, requiredCapability) {
  const accounts = (ctx.connectedAccounts ?? [])
    .map((account) => ({
      ...account,
      capabilities: createCapabilityMap(account.capabilities)
    }))
    .filter((account) => account.tokenStatus === "active");

  if (input.accountId) {
    const exact = accounts.find((account) => matchesAccountIdentity(account, input.accountId));
    if (!exact) {
      // The LLM frequently invents an accountId ("default", "primary",
      // "user@gmail.com", etc.) that doesn't correspond to any connected
      // account. Hard-erroring loses the recovery path. Surface the
      // list of viable accountIds so the next planner turn can self-
      // correct, AND label the variant so callers can decide whether
      // to retry-without-accountId or block.
      // Render available accounts as "<email> (<provider>)" so the LLM
      // copy-pastes the EMAIL — which the forgiving matcher can resolve
      // even with extra whitespace / colons / parens around it — rather
      // than the previous "<provider>/<email>" form that the LLM kept
      // turning into "<provider> <email>" with a literal space.
      return {
        status: "error",
        errorCode: "ACCOUNT_NOT_FOUND",
        message: `accountId "${input.accountId}" 不在已连接账户列表中。可用账户：${
          accounts.length === 0
            ? "（无）请在桌面里连接 Gmail / Outlook"
            : accounts.map((a) => `${a.email ?? a.id} (${a.provider})`).join("、")
        }。建议直接传 accountId 为邮箱地址，或省略 accountId 让系统自动选择默认账户。`,
        availableAccounts: accounts.map((a) => ({
          accountId: a.id,
          provider: a.provider,
          email: a.email ?? null
        }))
      };
    }
    if (!exact.capabilities[requiredCapability]) {
      return buildReauthRequired(exact, requiredCapability);
    }
    return exact;
  }

  let candidates = accounts.filter((account) => account.capabilities[requiredCapability]);
  if (input.provider) {
    candidates = candidates.filter((account) => account.provider === input.provider);
  } else {
    const inferred = inferPreferredProvider(ctx.userUtterance ?? "");
    if (inferred) {
      const narrowed = candidates.filter((account) => account.provider === inferred);
      if (narrowed.length > 0) candidates = narrowed;
    }
  }

  const purpose = capabilityToPurpose(requiredCapability);
  const defaults = purpose ? candidates.filter((account) => isDefaultForPurpose(account, purpose)) : [];
  if (defaults.length === 1) return defaults[0];
  if (candidates.length === 1) return candidates[0];

  const sorted = [...candidates].sort((a, b) => {
    const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bt = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    return bt - at;
  });

  if (sorted.length > 1) {
    return {
      status: "account_selection_required",
      candidates: sorted.map(candidateView),
      message: "检测到多个可用账户，请指定要使用的账户。"
    };
  }

  const providerAccounts = input.provider
    ? accounts.filter((account) => account.provider === input.provider)
    : accounts;
  const missingCapabilityAccount = providerAccounts.find((account) => !account.capabilities[requiredCapability]);
  if (missingCapabilityAccount) {
    return buildReauthRequired(missingCapabilityAccount, requiredCapability);
  }

  return {
    status: "error",
    errorCode: "NO_ACCOUNT_WITH_REQUIRED_CAPABILITY",
    message: `没有具备 ${requiredCapability} 能力的已连接账户。`
  };
}
