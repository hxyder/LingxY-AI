export const WAKE_PHRASES = [
  "linxi", "lin xi", "lin-xi", "lingxi", "ling xi", "lynx",
  "linsee", "lin see", "linsey", "lindsay", "linsy",
  "林夕", "林西", "林氏", "林熙", "林希", "林喜", "林溪", "林犀",
  "林席", "林系", "林细", "林戏", "林昔", "林洗", "林奇", "林起",
  "林其", "林期", "林琪", "林琦", "林齐", "林七", "林息", "林惜",
  "林师", "林施", "林诗", "林医师", "林醫師", "林医生", "林醫生",
  "林戲", "林齊", "林錫", "林襲",
  "琳西", "琳熙", "琳溪", "琳希", "琳奇", "琳琪",
  "灵犀", "灵溪", "灵熙", "灵希", "邻西", "邻熙", "凌溪", "凌西", "凌希",
  "靈犀", "靈溪", "靈熙", "靈希", "鄰西", "鄰熙", "淩溪", "淩西", "淩希",
  "临溪", "临西", "淋溪", "淋西", "零西", "零息", "令西", "令希",
  "臨溪", "臨西"
];

const WAKE_FIRST_CHARS = "林琳凌淩灵靈邻鄰临臨淋零令陵麟";
const WAKE_SECOND_CHARS = "夕西氏熙希喜溪犀席系细細戏戲昔洗袭襲奇起其期琪琦齐齊七息惜稀锡錫晰熹";
const WAKE_REGEX_CN = new RegExp(`[${WAKE_FIRST_CHARS}]\\s*[${WAKE_SECOND_CHARS}]`);
const WAKE_REGEX_LATIN = /\b(?:lin|ling|lyn)[\s-]*(?:xi|see|sey|sy|x)\b|\b(?:lindsay|linsey|linsee|lynx)\b/i;

export const DEFAULT_WAKE_DISPLAY_NAME = "linxi";
export const DEFAULT_WAKE_PROFILE = Object.freeze({
  displayName: DEFAULT_WAKE_DISPLAY_NAME,
  phrases: WAKE_PHRASES,
  includeDefault: true
});

export const NOTE_PHRASES = [
  "开始录音", "開始錄音", "start recording", "开始录制", "開始錄製",
  "开始记录", "開始記錄", "录音笔记", "錄音筆記", "会议记录", "會議記錄",
  "会议纪要", "會議紀要", "meeting notes", "voice note"
];

const WAKE_TRADITIONAL_NORMALIZATION = Object.freeze({
  靈: "灵",
  鄰: "邻",
  臨: "临",
  淩: "凌",
  戲: "戏",
  細: "细",
  襲: "袭",
  齊: "齐",
  錫: "锡",
  領: "领",
  醫: "医",
  師: "师",
  詩: "诗",
  悟: "悟"
});

export function normalizeForMatch(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[靈鄰臨淩戲細襲齊錫領悟]/g, (ch) => WAKE_TRADITIONAL_NORMALIZATION[ch] ?? ch)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesAny(text, phrases) {
  const norm = normalizeForMatch(text);
  return phrases.some((phrase) => norm.includes(normalizeForMatch(phrase)));
}

export function normalizeWakePhrases(value, { max = 12 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const phrases = [];
  for (const item of value) {
    const phrase = String(item ?? "").trim();
    if (!phrase) continue;
    const key = normalizeForMatch(phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return Number.isFinite(max) ? phrases.slice(0, max) : phrases;
}

export function buildWakeProfile(settings = {}) {
  const source = settings?.echoWake && typeof settings.echoWake === "object"
    ? settings.echoWake
    : settings;
  const customPhrases = normalizeWakePhrases(source?.phrases, { max: 12 });
  const includeDefault = source?.includeDefault !== false;
  const displayName = String(source?.displayName || customPhrases[0] || DEFAULT_WAKE_DISPLAY_NAME).trim()
    || DEFAULT_WAKE_DISPLAY_NAME;
  const phrases = [
    ...(includeDefault ? DEFAULT_WAKE_PROFILE.phrases : []),
    ...customPhrases
  ];
  return {
    displayName,
    phrases: normalizeWakePhrases(phrases, { max: Infinity }),
    includeDefault
  };
}

export function enrollmentTargetPhrases(profile = DEFAULT_WAKE_PROFILE) {
  const phrases = Array.isArray(profile?.phrases) ? profile.phrases : [];
  const isCustomDisplayName = (profile?.displayName ?? DEFAULT_WAKE_DISPLAY_NAME)
    !== DEFAULT_WAKE_DISPLAY_NAME;
  if (!isCustomDisplayName) return phrases;
  const defaultKeys = new Set(DEFAULT_WAKE_PROFILE.phrases.map(normalizeForMatch));
  const filtered = phrases.filter((phrase) => !defaultKeys.has(normalizeForMatch(phrase)));
  if (profile.displayName && !filtered.some((phrase) => normalizeForMatch(phrase) === normalizeForMatch(profile.displayName))) {
    filtered.unshift(profile.displayName);
  }
  return filtered;
}

export function matchesWake(text, profile = DEFAULT_WAKE_PROFILE) {
  const wakeProfile = profile?.phrases ? profile : buildWakeProfile(profile);
  if (matchesAny(text, wakeProfile.phrases)) return true;
  if (wakeProfile.includeDefault) {
    if (WAKE_REGEX_CN.test(normalizeForMatch(text))) return true;
    if (WAKE_REGEX_LATIN.test(text)) return true;
  }
  return false;
}

export function classifyWakeTranscript(text, profile = DEFAULT_WAKE_PROFILE) {
  if (!matchesWake(text, profile)) return null;
  return matchesAny(text, NOTE_PHRASES) ? "note" : "voice";
}
