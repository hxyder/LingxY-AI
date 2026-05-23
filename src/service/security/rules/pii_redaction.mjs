export const PII_RULES = Object.freeze([
  { id: "email", regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: "EMAIL" },
  { id: "phone_cn", regex: /1[3-9]\d{9}/g, replacement: "PHONE_CN" },
  { id: "idcard_cn", regex: /\b\d{17}[\dxX]\b/g, replacement: "IDCARD_CN" },
  { id: "bankcard", regex: /\b\d{15,19}\b/g, replacement: "BANKCARD" },
  { id: "jwt", regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "JWT" },
  { id: "ipv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "IPV4" }
]);

export function redactText(text, enabledRuleIds = PII_RULES.map((rule) => rule.id)) {
  if (!text) {
    return {
      redactedText: text,
      map: {},
      applied: []
    };
  }

  let redactedText = text;
  const map = {};
  const applied = [];

  for (const rule of PII_RULES.filter((candidate) => enabledRuleIds.includes(candidate.id))) {
    let counter = 0;
    redactedText = redactedText.replace(rule.regex, (match) => {
      counter += 1;
      const token = `[${rule.replacement}_${counter}]`;
      map[token] = match;
      return token;
    });
    if (counter > 0) {
      applied.push(`${rule.id}:${counter}`);
    }
  }

  return {
    redactedText,
    map,
    applied
  };
}

export function unredactText(text, map = {}) {
  if (!text) {
    return text;
  }

  let restored = text;
  for (const [token, original] of Object.entries(map)) {
    restored = restored.split(token).join(original);
  }
  return restored;
}
