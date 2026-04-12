/**
 * UCA-048 — Centralised feature flags.
 *
 * Every toggleable feature registers here with a default-enabled state,
 * a human label, a short description, and an anchor id so the Console
 * Settings panel can deep-link to the toggle for that feature when the
 * user tries to use a disabled feature from the Overlay.
 *
 * Reading order:
 *   configStore.load().features?.[featureId]?.enabled ?? REGISTRY default
 *
 * When a feature is disabled:
 *   - Service-side: `requireFeature()` returns `{ ok: false, ... }`
 *     and callers short-circuit with a user-facing explanation.
 *   - Client-side (Overlay): `requireFeatureOverlay()` shows a pop bubble
 *     with a "打开设置" button that navigates to the Settings anchor.
 */

export const FEATURE_REGISTRY = Object.freeze([
  { id: "translation",                label: "翻译",             description: "免费翻译功能（浏览器选区 / Overlay 快捷翻译）",       defaultEnabled: true,  settingsAnchor: "features.translation" },
  { id: "voice_input",                label: "语音输入",          description: "Overlay 语音识别 + 听写转文字",                       defaultEnabled: true,  settingsAnchor: "features.voice_input" },
  { id: "email_monitoring",           label: "邮件监测",          description: "IMAP/Graph 邮件轮询 + 自动 schedule + 回复追踪",      defaultEnabled: true,  settingsAnchor: "features.email_monitoring" },
  { id: "morning_digest",             label: "早晨邮件汇总",       description: "每日早晨自动汇总昨日邮件",                            defaultEnabled: true,  settingsAnchor: "features.morning_digest" },
  { id: "inline_web_result",          label: "网页内联结果",       description: "浏览器选区翻译 / 总结 / 解释 在网页内直接显示",         defaultEnabled: true,  settingsAnchor: "features.inline_web_result" },
  { id: "active_window_probe",        label: "活动窗口探测",       description: "热键唤起时自动检测当前窗口 URL / 文件路径",            defaultEnabled: true,  settingsAnchor: "features.active_window_probe" },
  { id: "web_search_fetch",           label: "网络搜索",          description: "AI 自动调用 DuckDuckGo 搜索获取最新信息",              defaultEnabled: true,  settingsAnchor: "features.web_search_fetch" },
  { id: "multi_intent_decomposition", label: "多意图分解",         description: "一句话拆成多个子任务并行执行",                        defaultEnabled: true,  settingsAnchor: "features.multi_intent_decomposition" },
  { id: "schedule_reminders",         label: "定时提醒",          description: "Schedule lead-time 提前通知",                        defaultEnabled: true,  settingsAnchor: "features.schedule_reminders" },
  { id: "projects_and_history",       label: "项目与历史",         description: "Overlay 多项目 / 多会话 / 历史记录",                  defaultEnabled: true,  settingsAnchor: "features.projects_and_history" }
]);

const FEATURE_MAP = Object.freeze(
  Object.fromEntries(FEATURE_REGISTRY.map((f) => [f.id, f]))
);

/**
 * Read the feature flag state from configStore. Falls back to the
 * FEATURE_REGISTRY default when the config file has no entry for the
 * feature (fail-open: missing config = feature enabled by default).
 */
export function isFeatureEnabled(featureId, configStore = null) {
  const definition = FEATURE_MAP[featureId];
  if (!definition) return true; // unknown feature → allow (fail-open)

  if (configStore) {
    try {
      const config = configStore.load();
      const entry = config.features?.[featureId];
      if (entry && typeof entry.enabled === "boolean") {
        return entry.enabled;
      }
    } catch { /* config read failure → fall back to default */ }
  }

  return definition.defaultEnabled;
}

/**
 * Gate a feature. Returns `{ ok: true }` if enabled, or
 * `{ ok: false, featureId, label, redirectTabAnchor, message }` if
 * disabled — callers should surface the message to the user and offer
 * a link to `redirectTabAnchor` in Console Settings.
 */
export function requireFeature(featureId, configStore = null) {
  if (isFeatureEnabled(featureId, configStore)) {
    return { ok: true };
  }
  const def = FEATURE_MAP[featureId] ?? { label: featureId, settingsAnchor: "features" };
  return {
    ok: false,
    featureId,
    label: def.label,
    redirectTabAnchor: def.settingsAnchor,
    message: `"${def.label}" 功能已在设置中关闭。点击打开设置以重新启用。`
  };
}

/**
 * Return the current state of all features for the Settings UI to
 * render the toggle matrix.
 */
export function listFeatureStates(configStore = null) {
  return FEATURE_REGISTRY.map((def) => ({
    ...def,
    enabled: isFeatureEnabled(def.id, configStore)
  }));
}

import os from "node:os";
import path from "node:path";

/**
 * Resolve the default output directory for generated artifacts.
 * Reads `config.output.defaultDir`; falls back to `~/Documents/UCA`.
 */
export function resolveDefaultOutputDir(configStore = null) {
  if (configStore) {
    try {
      const config = configStore.load();
      const dir = config.output?.defaultDir;
      if (typeof dir === "string" && dir.trim()) return dir.trim();
    } catch { /* fall through */ }
  }
  return path.join(os.homedir(), "Documents", "UCA");
}
