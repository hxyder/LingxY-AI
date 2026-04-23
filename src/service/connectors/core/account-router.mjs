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

function matchesAccountIdentity(account, value) {
  if (!value) return false;
  return sameText(account.id, value)
    || sameText(account.accountId, value)
    || sameText(account.email, value)
    || sameText(account.providerAccountId, value)
    || sameText(account.displayName, value);
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
      return {
        status: "error",
        errorCode: "ACCOUNT_NOT_FOUND",
        message: "指定账户不存在或不可用。"
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
