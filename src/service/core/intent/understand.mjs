/**
 * Understanding LLM — decides whether an ambiguous command is a scheduling
 * request ("5 分钟后 X") or an immediate action that happens to mention a
 * time ("create a calendar event at 1pm tomorrow"). Returns null when no
 * provider is configured so the caller falls back to normal routing.
 *
 * This is the one-call LLM layer that sits between the cheap regex trigger
 * and the executor. It replaces the rigid "regex says time-offset → it's a
 * schedule" decision that shipped in Week 1 and mis-read
 *   "打开 outlook，在日历里新建一个 30 分钟的任务，标题叫吃饭。时间在明天下午1点"
 * as a 15-hour-later schedule of a truncated command.
 */

const SYSTEM_PROMPT = `You classify a short user command. The command MAY contain a time-like phrase (e.g. "5 分钟后", "明天下午1点", "in 10 minutes"). Decide one of three interpretations and return ONE JSON object only.

Interpretations:
- "schedule": The user wants the AI to execute something LATER, at the time mentioned. Example: "5 分钟后发美股汇总到 x@y.com" — run the whole "send US stock summary" later.
- "immediate": The time phrase is DATA for the action being performed NOW. Example: "在日历里新建一个时间在明天下午1点的任务" — create the event NOW, the time is just the event's start time, NOT a scheduling delay.
- "needs_clarification": User's intent cannot be resolved without asking one more question (e.g. recipient missing for an email the user clearly wants to send).

Fields in output:
{
  "interpretation": "schedule" | "immediate" | "needs_clarification",
  "schedule_at": ISO8601 string | null,          // only for schedule
  "residual_command": string | null,             // only for schedule: the AI-facing instruction to run when the schedule fires (strip the time phrase, keep the rest coherent)
  "clarification_question": string | null        // only for needs_clarification, in the user's language
}

Rules:
- If the time phrase describes WHEN THE AI SHOULD EXECUTE (delay), it's "schedule".
- If the time phrase is an ARGUMENT to the action (event start time, meeting time, reminder datetime that the tool itself accepts), it's "immediate".
- Prefer "immediate" when the command has multiple clauses / verbs besides the time.
- residual_command must be a STANDALONE instruction — when the schedule fires later, the AI will receive it as the new user request. Keep it faithful to user intent; do NOT invent details.

Output ONLY the JSON object. No prose, no code fences.`;

export async function understandCommand({ userCommand, now = new Date() }) {
  const { resolveProviderForTask } = await import("../../executors/shared/provider-resolver.mjs");
  const provider = resolveProviderForTask("chat");
  if (!provider || provider.kind === "code_cli") return null;

  const userPrompt = `Current local time: ${now.toISOString()}\nCommand: ${userCommand}`;
  try {
    let text = "";
    if (provider.kind === "anthropic") {
      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        })
      });
      const data = await response.json();
      text = data.content?.find((b) => b.type === "text")?.text ?? "";
    } else {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 512,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt }
          ]
        })
      });
      const data = await response.json();
      text = data.choices?.[0]?.message?.content ?? "";
    }

    const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!["schedule", "immediate", "needs_clarification"].includes(parsed.interpretation)) return null;
    return parsed;
  } catch {
    return null;
  }
}
