/**
 * UCA-077 P1-02: source scope detector.
 *
 * Decides what the user is pointing at: uploaded_files, current_context,
 * local_project, selection, or none. The policy resolver uses this as the
 * negative web-search signal — local sources keep web_search forbidden by
 * default.
 *
 * Strong > weak rule: any of file_paths / image_paths / explicit context
 * indicators is strong; mere selection_text is weak.
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "source_scope";

const CURRENT_CONTEXT_PATTERN = /(这个框架|当前框架|这段代码|这个代码|这段|这个文件|这些文件|上传的文件|这个流程|这个项目|我的程序|我的项目|本地项目|本地代码|刚才的日志|下面[的]?(?:流程|代码|内容|日志|文件|文档|这段)|根据我提供的|根据上面|根据下面|这份文档|这篇文章|这个文档|这篇内容|当前选中|这里(?:的)?(?:代码|内容|流程))/;

const LOCAL_PROJECT_PATTERN = /(整个项目|整个仓库|整个代码库|repo\s+root|当前仓库|本地仓库)/i;

/**
 * @param {string} text
 * @param {object} contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, contextPacket) {
  const filePaths = Array.isArray(contextPacket?.file_paths) ? contextPacket.file_paths : [];
  const imagePaths = Array.isArray(contextPacket?.image_paths) ? contextPacket.image_paths : [];
  const selectionText = String(contextPacket?.text ?? "").trim();

  if (filePaths.length > 0 || imagePaths.length > 0) {
    return {
      name: NAME,
      matched: true,
      strength: "strong",
      evidence: [{
        type: "context",
        source: NAME,
        matched: filePaths[0] ?? imagePaths[0],
        reason: `contextPacket has ${filePaths.length} file(s) and ${imagePaths.length} image(s) attached`
      }],
      hint: { value: "uploaded_files" }
    };
  }

  const localMatch = LOCAL_PROJECT_PATTERN.exec(text);
  if (localMatch) {
    return {
      name: NAME,
      matched: true,
      strength: "strong",
      evidence: [{
        type: "regex",
        source: NAME,
        matched: localMatch[0],
        reason: "user references the whole local project"
      }],
      hint: { value: "local_project" }
    };
  }

  const ctxMatch = CURRENT_CONTEXT_PATTERN.exec(text);
  if (ctxMatch) {
    return {
      name: NAME,
      matched: true,
      strength: "strong",
      evidence: [{
        type: "regex",
        source: NAME,
        matched: ctxMatch[0],
        reason: "user references the current/provided context"
      }],
      hint: { value: "current_context" }
    };
  }

  // UCA-077 P1-10: only treat contextPacket.text as a "selection" if it is
  // meaningfully different from the user's command. action-tool-submission
  // (and other manual-capture paths) duplicate the userCommand into
  // contextPacket.text by default, which would otherwise mis-classify every
  // bare action-tool request as a local-selection task and forbid web search.
  const trimmedCommand = String(text ?? "").trim();
  const isJustCommandEcho = selectionText.length > 0 && selectionText === trimmedCommand;
  if (selectionText.length > 0 && !isJustCommandEcho) {
    return {
      name: NAME,
      matched: true,
      strength: "weak",
      evidence: [{
        type: "context",
        source: NAME,
        reason: `contextPacket.text is non-empty (${selectionText.length} chars) and distinct from user command`
      }],
      hint: { value: "selection" }
    };
  }

  return { ...emptySignal(NAME), hint: { value: "none" } };
}
