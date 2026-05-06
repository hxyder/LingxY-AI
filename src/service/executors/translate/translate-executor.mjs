/**
 * Translate Executor — performs translation using the free, no-key
 * translation providers (MyMemory + Google web fallback). It does NOT
 * require an AI provider to be configured, so it works out of the box.
 *
 * The executor reads source text from `task.context_packet.text` (selection,
 * clipboard, file_metadata text, etc.) and the desired target language can
 * be passed via `task.context_packet.translation_target` or inferred from
 * the user_command (e.g. "translate to English"). When the source language
 * is the same as the target, it short-circuits and echoes the input.
 */

import { translateText } from "../../translation/free-translator.mjs";

const TARGET_HINT_RULES = [
  { pattern: /(into|to|为|成|至)\s*(simplified\s*chinese|chinese|zh|中文|简体中文|汉语)/i, target: "zh-CN" },
  { pattern: /(into|to|为|成|至)\s*(traditional\s*chinese|繁体|繁體)/i, target: "zh-TW" },
  { pattern: /(into|to|为|成|至)\s*(english|en|英语|英文)/i, target: "en" },
  { pattern: /(into|to|为|成|至)\s*(japanese|ja|日语|日文)/i, target: "ja" },
  { pattern: /(into|to|为|成|至)\s*(korean|ko|韩语|韩文|韓語)/i, target: "ko" },
  { pattern: /(into|to|为|成|至)\s*(french|fr|法语|法文)/i, target: "fr" },
  { pattern: /(into|to|为|成|至)\s*(german|de|德语|德文)/i, target: "de" },
  { pattern: /(into|to|为|成|至)\s*(spanish|es|西班牙语)/i, target: "es" },
  { pattern: /(into|to|为|成|至)\s*(russian|ru|俄语|俄文)/i, target: "ru" },
  { pattern: /(into|to|为|成|至)\s*(arabic|ar|阿拉伯语)/i, target: "ar" }
];

export function inferTargetLanguageFromCommand(userCommand = "") {
  const text = String(userCommand ?? "");
  for (const rule of TARGET_HINT_RULES) {
    if (rule.pattern.test(text)) return rule.target;
  }
  return null;
}

function pickSourceText(task) {
  const packet = task?.context_packet ?? {};
  const direct = (packet.text ?? "").trim();
  if (direct) return direct;

  // multi-file context — concatenate first ~2000 chars from each file
  const fromFiles = (packet.file_metadata ?? [])
    .map((meta) => (meta.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (fromFiles) return fromFiles.slice(0, 4000);

  // selection metadata fallback
  const selectionText = packet.selection_metadata?.selection_text ?? packet.selection_metadata?.text ?? "";
  if (selectionText) return String(selectionText).trim();

  return "";
}

export function createTranslateExecutorScaffold({ translator = translateText } = {}) {
  return {
    id: "translate",
    model: "free-translator",
    supportsStreaming: true,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Translate executor cancelled before start."), { code: "ABORT_ERR" });
      }

      const sourceText = pickSourceText(task);
      if (!sourceText) {
        const message = "没有可翻译的文本（未在上下文中找到 text 字段）。";
        yield { event_type: "log", payload: { message } };
        yield { event_type: "inline_result", payload: { text: message } };
        yield { event_type: "success", payload: { text: message } };
        return;
      }

      const target = task?.context_packet?.translation_target
        ?? inferTargetLanguageFromCommand(task?.user_command)
        ?? null; // null = pickDefaultTarget will choose based on detected source

      yield {
        event_type: "step_started",
        payload: { step: "free_translate", progress: 0.1 }
      };

      yield {
        event_type: "log",
        payload: { message: `Translating ${sourceText.length} chars (target=${target ?? "auto"})...` }
      };

      let result;
      try {
        result = await translator({
          text: sourceText,
          target,
          signal
        });
      } catch (error) {
        if (error.code === "ABORT_ERR" || error.name === "AbortError") {
          throw Object.assign(new Error("Translate executor cancelled."), { code: "ABORT_ERR" });
        }
        const failureMessage = `免费翻译服务调用失败：${error.message}。请检查网络连接，或在 Console → Settings 中配置一个 AI 提供方作为备选。`;
        yield { event_type: "log", payload: { message: failureMessage } };
        yield { event_type: "inline_result", payload: { text: failureMessage } };
        yield { event_type: "success", payload: { text: failureMessage } };
        return;
      }

      yield {
        event_type: "step_finished",
        payload: { step: "free_translate", progress: 0.95 }
      };

      const finalText = result.text;

      yield {
        event_type: "inline_result",
        payload: {
          text: finalText,
          translation: {
            source_language: result.source_language,
            target_language: result.target_language,
            provider: result.provider,
            input: result.input,
            chunks: result.chunks
          }
        }
      };

      yield {
        event_type: "success",
        payload: {
          text: finalText,
          summary: result.text.slice(0, 200)
        }
      };
    }
  };
}
