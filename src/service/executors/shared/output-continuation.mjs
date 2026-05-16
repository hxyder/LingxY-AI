const OUTPUT_LIMIT_REASONS = new Set([
  "length",
  "max_tokens",
  "max_output_tokens",
  "model_length",
  "context_length_exceeded",
  "limit"
]);

export function hasCjk(value = "") {
  return /[\u3400-\u9fff]/u.test(String(value ?? ""));
}

export function outputLimitFinishReason(response = {}) {
  if (response?.output_limited === true) {
    return response.finish_reason ?? response.stop_reason ?? "output_limited";
  }
  const reason = `${response?.finish_reason ?? response?.stop_reason ?? ""}`.trim().toLowerCase();
  return OUTPUT_LIMIT_REASONS.has(reason)
    ? (response.finish_reason ?? response.stop_reason ?? reason)
    : null;
}

export function buildContinuationMessages(messages = [], partialText = "", purpose = "final_answer") {
  const partial = String(partialText ?? "").slice(-12000);
  const instruction = [
    "Continue exactly from where the previous answer stopped.",
    "Do not restart, summarize, or repeat text already written.",
    "Keep the same language, structure, and formatting.",
    purpose === "side_effect_body"
      ? "Write only the remaining side-effect body content; do not claim the side effect was sent or completed."
      : "Finish the answer completely."
  ].join(" ");
  return [
    ...messages,
    { role: "assistant", content: partial },
    { role: "user", content: instruction }
  ];
}

export function incompleteOutputNotice(task = {}) {
  return hasCjk(task?.user_command)
    ? "\n\n（已达到模型输出长度上限并自动续写多次；如果你需要，我可以继续从这里补完剩余部分。）"
    : "\n\n(Output reached the model length limit after automatic continuation; I can continue from here if more detail is needed.)";
}

export async function generateTextWithContinuations({
  adapter,
  messages,
  tools = [],
  continuationTools = tools,
  initialMaxTokens = 2048,
  continuationMaxTokens = 2048,
  maxContinuations = 2,
  signal = null,
  fetchImpl = null,
  purpose = "final_answer",
  onTextDelta = null,
  onToolInputDelta = null,
  onReasoningDelta = null,
  onUsage = null,
  onOutputLimited = null,
  onContinuationStarted = null,
  shouldContinue = null
} = {}) {
  if (!adapter || typeof adapter.generate !== "function") {
    throw new TypeError("generateTextWithContinuations requires an adapter with generate().");
  }
  let text = "";
  let finalLimitReason = null;
  const responses = [];

  for (let continuationIndex = 0; continuationIndex <= maxContinuations; continuationIndex += 1) {
    const attemptMessages = continuationIndex === 0
      ? messages
      : buildContinuationMessages(messages, text, purpose);
    let streamedText = "";
    const response = await adapter.generate({
      messages: attemptMessages,
      tools: continuationIndex === 0 ? tools : continuationTools,
      maxTokens: continuationIndex === 0 ? initialMaxTokens : continuationMaxTokens,
      signal,
      fetchImpl: typeof fetchImpl === "function" ? fetchImpl : undefined,
      onTextDelta: typeof onTextDelta === "function"
        ? (delta) => {
            if (!delta) return;
            streamedText += delta;
            onTextDelta(delta, { continuationIndex });
          }
        : undefined,
      onToolInputDelta: typeof onToolInputDelta === "function" ? onToolInputDelta : undefined,
      onReasoningDelta: typeof onReasoningDelta === "function" ? onReasoningDelta : undefined
    });
    responses.push(response);
    const piece = streamedText || response?.text || "";
    if (piece) text += piece;

    const limitReason = outputLimitFinishReason(response);
    onUsage?.({
      response,
      continuationIndex,
      attemptMessages,
      limitReason,
      outputLimited: Boolean(limitReason)
    });

    const continueAllowed = typeof shouldContinue === "function"
      ? shouldContinue({ response, continuationIndex, limitReason, text })
      : Boolean(limitReason);
    if (!limitReason || !continueAllowed) {
      finalLimitReason = null;
      break;
    }

    finalLimitReason = limitReason;
    onOutputLimited?.({
      response,
      continuationIndex,
      limitReason,
      text
    });
    if (continuationIndex < maxContinuations) {
      onContinuationStarted?.({
        continuationIndex: continuationIndex + 1,
        previousLimitReason: limitReason,
        text
      });
    }
  }

  return {
    text: String(text ?? "").trim(),
    outputLimited: Boolean(finalLimitReason),
    finalLimitReason,
    responses,
    firstResponse: responses[0] ?? null,
    lastResponse: responses.at(-1) ?? null
  };
}
