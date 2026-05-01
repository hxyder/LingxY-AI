/**
 * UCA-054: Build a proper multi-turn messages array that injects tool
 * observations as actual message turns (not just system-prompt text).
 *
 * Pattern (ReAct: Thought -> Action -> Observation):
 *   user:      original request
 *   assistant: {"tool": "web_search_fetch", "args": {...}}
 *   user:      [Tool result] <observation text>
 *   assistant: {"tool": "..."} | {"final": "..."}
 *   ...
 *
 * The LLM genuinely sees each observation before it decides the next step,
 * eliminating the "LLM answers from memory without calling tools" failure mode.
 */
export function buildConversationMessages(prefixMessages, transcript, initialFilePaths = []) {
  const messages = Array.isArray(prefixMessages) ? [...prefixMessages] : [];

  // UCA-179: roll up every artifact_paths seen so far so a later tool call
  // (e.g. send_email, account_upload_file) always sees the full list. We
  // append this as a short addendum to each tool observation.
  // Seed with the user-attached files from the context packet — a user who
  // says "send this file to x@y.com" expects it to land as an attachment.
  const seenArtifacts = Array.isArray(initialFilePaths)
    ? initialFilePaths.filter(Boolean).slice()
    : [];

  for (const entry of transcript) {
    if (entry.type === "tool_result") {
      // Represent the assistant's tool call decision.
      messages.push({
        role: "assistant",
        content: JSON.stringify({ tool: entry.tool, args: entry.args ?? {} })
      });
      // Inject the actual observation as a user turn (standard ReAct convention).
      const successNote = entry.success === false
        ? "\n[IMPORTANT: This tool call FAILED. Do NOT claim success. You must handle the failure.]"
        : "";
      const metadataNote = entry.metadata
        ? `\n[Tool metadata JSON]\n${JSON.stringify(entry.metadata)}`
        : "";
      for (const p of entry.artifact_paths ?? []) {
        if (p && !seenArtifacts.includes(p)) seenArtifacts.push(p);
      }
      const artifactNote = seenArtifacts.length > 0
        ? `\n[Artifacts available so far — pass any of these verbatim to attachmentPaths / localPath / file arguments if the user asks to attach / send / upload]:\n${seenArtifacts.map((p) => `- ${p}`).join("\n")}`
        : "";
      messages.push({
        role: "user",
        content: `[Tool observation: ${entry.tool}]\n${entry.observation ?? "(no result)"}${metadataNote}${artifactNote}${successNote}`
      });
    } else if (entry.type === "tool_denied") {
      messages.push({
        role: "assistant",
        content: JSON.stringify({ tool: entry.tool, args: {} })
      });
      messages.push({
        role: "user",
        content: `[Tool denied: ${entry.tool}] Reason: ${entry.reason ?? "user denied"}`
      });
    } else if (entry.type === "validation_error") {
      messages.push({
        role: "user",
        content: `[Validation error for ${entry.tool}]: ${entry.error ?? "invalid arguments"}`
      });
    } else if (entry.type === "prose_trap_retry") {
      // 83.1: Reinject the LLM's prose-only reply as an assistant turn, then
      // a synthetic user turn pointing out that no tool call was made. This
      // breaks the loop where the model promises an action ("我来帮你发邮
      // 件...") but emits no tool_calls, causing the outer loop to exit
      // with type:"final" — the user sees a promise that was never kept,
      // and has to re-submit the request to get the tool actually called.
      messages.push({
        role: "assistant",
        content: entry.assistantProse ?? ""
      });
      messages.push({
        role: "user",
        content: entry.retryHint
          ?? "你上面说要执行操作，但没有发出 tool_call。如果确实需要操作，请直接调用工具；如果只是回答/解释而不需要操作，请重新输出最终答复（纯文本）。"
      });
    } else if (entry.type === "runbook_guidance") {
      messages.push({
        role: "user",
        content: `[Runbook recovery: ${entry.runbook_id}]\n${entry.instruction}`
      });
    } else if (entry.type === "contract_guidance") {
      messages.push({
        role: "user",
        content: `[Required action handoff: ${(entry.groups ?? []).join(", ")}]\n${entry.instruction}`
      });
    } else if (entry.type === "saturation_hint") {
      const repeated = Array.isArray(entry.repeated_domains) && entry.repeated_domains.length > 0
        ? entry.repeated_domains.slice(0, 4).join(", ")
        : "the same publishers";
      const window = entry.window_size ?? 3;
      messages.push({
        role: "user",
        content: `(system note) The last ${window} web fetches added no new independent publishers/domains beyond ${repeated}. Decide based on what you already have: if the evidence covers the question, synthesize the answer now; if not, try a meaningfully different angle (different keywords, different language, an alternate authoritative URL) — do not repeat near-duplicate searches against the same publishers.`
      });
    } else if (entry.type === "synthesis_retry") {
      if (entry.assistantDraft) {
        messages.push({ role: "assistant", content: entry.assistantDraft });
      }
      const reasons = (entry.violations ?? []).map((v) => `- ${v.kind}: ${v.message}`).join("\n");
      messages.push({
        role: "user",
        content: `[Synthesis required] The previous draft did not satisfy the user's expected output. Issues:\n${reasons}\n\nRewrite the final answer in the user's language: read the prior tool observations above, transform them into the requested output kind, and respond as plain text. Do NOT call another tool unless new data is genuinely missing. Do NOT repeat raw observation lines verbatim.`
      });
    }
  }

  return messages;
}
