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
        required_capabilities: tool.required_capabilities,
        policy_group: tool.policy_group ?? null,
        requires_confirmation: tool.requires_confirmation === true
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
      const guard = applyPolicyGuard(toolId, args, ctx);
      if (!guard.allowed) return guard.result;
      return tool.execute(args, ctx);
    }
  };
}
