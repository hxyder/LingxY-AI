import { evaluateToolRisk } from "./risk_matrix.mjs";
import { applyPolicyGuard } from "./policy-guard.mjs";

export function createActionToolRegistry(tools = []) {
  const registered = new Map();
  for (const tool of tools) {
    registered.set(tool.id, tool);
  }

  return {
    register(tool) {
      registered.set(tool.id, tool);
      return tool;
    },
    get(toolId) {
      return registered.get(toolId) ?? null;
    },
    list() {
      return [...registered.values()].map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        risk_level: tool.risk_level,
        required_capabilities: tool.required_capabilities
      }));
    },
    evaluate(toolId, args, ctx) {
      const tool = this.get(toolId);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolId}`);
      }
      return evaluateToolRisk(tool, args, ctx);
    },
    async call(toolId, args, ctx) {
      const tool = this.get(toolId);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolId}`);
      }
      // UCA-077 P4-04: hard policy gate. Before this guard, the agentic
      // prompt and tool_using planner could only ASK the LLM not to call
      // forbidden tools — nothing actually stopped a misbehaving model.
      // Now `forbidden` is enforced at the registry boundary, and per-task
      // rate limits prevent runaway loops on billed/external tools.
      const guard = applyPolicyGuard(toolId, args, ctx);
      if (!guard.allowed) return guard.result;
      return tool.execute(args, ctx);
    }
  };
}
