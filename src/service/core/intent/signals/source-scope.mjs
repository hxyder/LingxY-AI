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
import { LOCAL_ANCHOR_KEYS, hasLocalAnchor } from "../context-sources.mjs";

const NAME = "source_scope";

// P4-03 follow-up: page pronouns added so a user explicitly asking the
// assistant to analyse a webpage anchors the task locally even though
// the synthetic browser metadata block (`[browser_metadata · ...]`) is
// no longer a local anchor on its own. "summarize this page" /
// "总结当前网页" → CURRENT_CONTEXT match → scope=current_context →
// resolver step 3 forbids web. Without these patterns, only a real
// selection or a file_path could anchor a browser-derived task.
const CURRENT_CONTEXT_PATTERN = /(这个框架|当前框架|这段代码|这个代码|这段|这个文件|这些文件|上传的文件|这个流程|这个项目|我的程序|我的项目|本地项目|本地代码|刚才的日志|下面[的]?(?:流程|代码|内容|日志|文件|文档|这段)|根据我提供的|根据上面|根据下面|这份文档|这篇文章|这个文档|这篇内容|当前选中|这里(?:的)?(?:代码|内容|流程)|这个网页|当前网页|这个页面|当前页面|这页内容|本页内容|这篇网页|this\s+page|this\s+webpage|the\s+(?:current\s+)?page)/i;

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
    // P4-01 kind=fact: contextPacket arrays are runtime-observable state.
    // No interpretation needed — the user attached N files.
    return {
      name: NAME,
      matched: true,
      strength: "strong",
      kind: "fact",
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
    // P4-01 kind=fact: literal phrase ("整个项目") leaves no
    // interpretation room — the user explicitly named the local project.
    return {
      name: NAME,
      matched: true,
      strength: "strong",
      kind: "fact",
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
    // P4-01 kind=assumption: pronoun-style references ("这个", "这段")
    // are interpreted as "the current local context", but the same
    // phrase can refer to a quoted external article in some flows. The
    // RAID Assumptions bucket (risk-register A-01) carries this same
    // interpretation explicitly.
    return {
      name: NAME,
      matched: true,
      strength: "strong",
      kind: "assumption",
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
  //
  // P4-02.x C3 (plan p4-03-p4-02-goofy-forest): the selection branch only
  // fires for genuinely local content. The C1 context-source classifier
  // (run in createTaskSpec before signal extraction) marks each kind of
  // text on the enriched contextPacket. We trust the classifier output:
  //
  //   - real_selection / browser_page / file_text  → local-only anchor
  //     → fire the selection branch with kind="fact"
  //
  //   - conversation_history / rag_background / parent_task_context /
  //     editable_artifact (alone)  → background only, NEVER an anchor
  //     → DO NOT fire the selection branch; fall through to "none"
  //
  // This is the fix for the "今天天气怎么样 + RAG-recalled email task →
  // forbidden web" regression. RAG digest, conversation history, and
  // parent task summaries used to all trigger the selection branch
  // because they share the contextPacket.text bucket; now the C1
  // classifier separates them.
  //
  // Back-compat fallback: when context_sources is absent (e.g. some
  // test path that bypasses createTaskSpec — should be impossible in
  // practice but kept defensive), use the legacy "non-empty distinct
  // text" heuristic. Belt-and-suspenders.
  const trimmedCommand = String(text ?? "").trim();
  const isJustCommandEcho = selectionText.length > 0 && selectionText === trimmedCommand;
  const sources = contextPacket?.context_sources;
  // Pull the anchor flags from C1's canonical LOCAL_ANCHOR_KEYS list
  // rather than hard-coding member names — when C1 evolves the anchor
  // set (e.g. P4-03 dropped `browser_page` from anchors), this branch
  // updates automatically.
  const hasRealLocalAnchorFlag = sources ? hasLocalAnchor(sources) : false;
  const hasRealLocalAnchorViaText = !sources && selectionText.length > 0 && !isJustCommandEcho;
  const hasRealLocalAnchorResult = hasRealLocalAnchorFlag || hasRealLocalAnchorViaText;
  if (hasRealLocalAnchorResult) {
    const reason = sources
      ? `context_sources flags a local anchor (${LOCAL_ANCHOR_KEYS.filter((k) => sources[k]).join(", ") || "(unknown)"})`
      : `contextPacket.text is non-empty (${selectionText.length} chars) and distinct from user command`;
    return {
      name: NAME,
      matched: true,
      strength: "weak",
      kind: "fact",
      evidence: [{
        type: "context",
        source: NAME,
        reason
      }],
      hint: { value: "selection" }
    };
  }

  return { ...emptySignal(NAME), hint: { value: "none" } };
}
