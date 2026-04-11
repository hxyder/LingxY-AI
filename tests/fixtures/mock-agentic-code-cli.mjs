/**
 * mock-agentic-code-cli.mjs — fixture for verify-agentic-planner.mjs.
 *
 * Simulates a Kimi-CLI-style code_cli provider that the agentic planner
 * drives via the JSON planning-mode bridge in code-cli-bridge.mjs.
 *
 * Behaviour:
 *   - First invocation: emits a stream-json transcript whose assistant
 *     turn contains a ```json {tool_call: ...}``` block requesting
 *     `web_search_fetch`.
 *   - Subsequent invocations: emits a final answer with no tool_call block.
 *
 * "First vs subsequent" is decided by inspecting the prompt sent on stdin:
 *   - If stdin already contains a `# Tool result (...)` section, the
 *     planner is on its second turn and we should produce a final answer.
 *   - Otherwise we issue the tool call.
 *
 * The fixture intentionally only writes to stdout (and a debug log to a
 * UCA_MOCK_CLI_LOG path if set) — no side effects on disk.
 */

import { writeFileSync } from "node:fs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (process.env.UCA_MOCK_CLI_LOG) {
    try {
      writeFileSync(process.env.UCA_MOCK_CLI_LOG, input, { encoding: "utf8" });
    } catch { /* ignore */ }
  }

  const isSecondTurn = /# Tool result \(/.test(input);

  let assistantText;
  if (isSecondTurn) {
    assistantText = "Based on the search results above, the latest AI trends in 2026 include multi-modal models and agentic runtimes. (Mock final answer.)";
  } else {
    assistantText = [
      "I will search for the latest information first.",
      "",
      "```json",
      JSON.stringify({
        tool_call: {
          name: "web_search_fetch",
          arguments: { query: "latest AI trends 2026", recency: "month" }
        }
      }, null, 2),
      "```"
    ].join("\n");
  }

  // Emit one stream-json line that the bridge's extractAssistantText() will
  // recognise as the final assistant turn.
  process.stdout.write(`${JSON.stringify({
    role: "assistant",
    content: [{ type: "text", text: assistantText }]
  })}\n`);
});
