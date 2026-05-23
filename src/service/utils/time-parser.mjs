/**
 * UCA-062 — Natural-language relative time parser.
 *
 * Converts phrases like "下午三点"、"明天早上九点"、"30分钟后" into an
 * absolute ISO timestamp anchored to a given `now` Date (defaults to the
 * current system time with correct timezone).
 *
 * Returns null when no recognisable time expression is found so callers can
 * fall back to their own parsing.
 */

// Period-of-day → canonical 24h anchor hour
const PERIOD_MAP = {
  凌晨: 1,
  早上: 8,
  上午: 9,
  中午: 12,
  下午: 14,
  晚上: 19,
  夜里: 21,
  夜间: 21
};

/**
 * Format a millisecond difference as a human-readable Chinese duration string.
 * e.g. 5400000 → "1 小时 30 分钟后"
 *
 * @param {number} diffMs  target - now (positive = future)
 * @returns {string}
 */
export function formatRelativeDuration(diffMs) {
  if (diffMs <= 0) return "已过期";
  const totalMin = Math.round(diffMs / 60_000);
  if (totalMin === 0) return "不到 1 分钟后";
  if (totalMin < 60) return `${totalMin} 分钟后`;
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (remMin === 0) return `${hours} 小时后`;
  return `${hours} 小时 ${remMin} 分钟后`;
}

// Map Chinese numeral characters to their integer values.
const ZH_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 两: 2 };

/**
 * Convert a mixed Chinese/Arabic numeral string to an integer.
 * Handles: "3", "三", "十二", "二十三"
 */
function parseChineseOrArabicNum(str) {
  if (!str) return NaN;
  if (/^\d+$/.test(str)) return Number(str);
  // Pure single Chinese character (一…九)
  if (str.length === 1 && ZH_NUM[str] !== undefined) return ZH_NUM[str];
  // 十X → 10 + X
  if (str.startsWith("十")) {
    const rest = ZH_NUM[str[1]] ?? 0;
    return 10 + rest;
  }
  // X十Y → X*10 + Y
  const tens = ZH_NUM[str[0]];
  if (tens !== undefined && str[1] === "十") {
    const ones = str.length > 2 ? (ZH_NUM[str[2]] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return NaN;
}

/**
 * Parse a relative time string and return the resolved Date + display string.
 *
 * Supported patterns:
 *  - "下午三点" / "下午 3 点半" / "晚上 8:30"
 *  - "明天早上九点" / "今天中午十二点" / "今天下午三点"
 *  - "30分钟后" / "2小时后" / "1天后"
 *  - "明天 15:00"
 *
 * @param {string}   text  User input containing the time expression
 * @param {Date}     now   Reference time (defaults to new Date())
 * @returns {{ ts: string, display: string, diffMs: number, relativeLabel: string } | null}
 */
export function parseRelativeTime(text, now = new Date()) {
  if (!text) return null;

  // ── Relative offsets: "30分钟后" / "2小时后" / "1天后" ──────────────────
  const offsetMatch = text.match(/(\d+)\s*(分钟|分|小时|天|minute|minutes|min|mins|hour|hours|day|days)\s*(?:以?后|later|from\s+now)/i);
  if (offsetMatch) {
    const amount = Number(offsetMatch[1]);
    const unit = offsetMatch[2].toLowerCase();
    let diffMs = 0;
    if (/分/.test(unit) || /min/.test(unit)) diffMs = amount * 60_000;
    else if (/小时|hour/.test(unit)) diffMs = amount * 3_600_000;
    else if (/天|day/.test(unit)) diffMs = amount * 86_400_000;
    if (diffMs > 0) {
      const target = new Date(now.getTime() + diffMs);
      return {
        ts: target.toISOString(),
        display: target.toLocaleString("zh-CN", { hour12: false }),
        diffMs,
        relativeLabel: formatRelativeDuration(diffMs)
      };
    }
  }

  // ── Absolute clock time with optional period and day offset ────────────
  // Match: (今天|明天|后天)? (凌晨|早上|上午|中午|下午|晚上)? (N点半? | HH:MM)
  // Hour can be Arabic digits OR Chinese numeral characters (三, 十二, etc.)
  const ZH_HOUR_CHARS = "零一二三四五六七八九十两〇";
  const clockMatch = text.match(
    new RegExp(
      `(今天|明天|后天|tomorrow)?\\s*` +
      `(凌晨|早上|上午|中午|下午|晚上|夜里|夜间)?\\s*` +
      `([${ZH_HOUR_CHARS}\\d]{1,3})\\s*` +
      `(?:[:：点])(?:\\s*([${ZH_HOUR_CHARS}\\d]{1,2}))?\\s*(半)?`, "i"
    )
  );
  if (clockMatch) {
    const [, dayWord, period, rawHour, rawMinute, half] = clockMatch;
    let hour = parseChineseOrArabicNum(rawHour);
    let minute = rawMinute != null ? parseChineseOrArabicNum(rawMinute) : (half ? 30 : 0);
    if (Number.isNaN(hour)) return null;
    if (Number.isNaN(minute)) minute = 0;

    // Apply period-of-day adjustment
    if (period && PERIOD_MAP[period] != null) {
      const anchor = PERIOD_MAP[period];
      if (hour < 12 && anchor >= 12) {
        hour += 12;
      }
      if (hour > 23) hour = 23;
    } else if (hour < 12 && /下午|晚上|夜/.test(text)) {
      hour += 12;
    }

    const target = new Date(now);
    if (/明天|tomorrow/.test(dayWord ?? "")) {
      target.setDate(target.getDate() + 1);
    } else if (/后天/.test(dayWord ?? "")) {
      target.setDate(target.getDate() + 2);
    }
    target.setHours(hour, minute, 0, 0);

    // If today and time has already passed, advance to tomorrow
    if (!dayWord && target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const diffMs = target.getTime() - now.getTime();
    return {
      ts: target.toISOString(),
      display: target.toLocaleString("zh-CN", { hour12: false }),
      diffMs,
      relativeLabel: formatRelativeDuration(diffMs)
    };
  }

  return null;
}
