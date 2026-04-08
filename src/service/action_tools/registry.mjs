import { evaluateToolRisk } from "./risk_matrix.mjs";

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
      return tool.execute(args, ctx);
    }
  };
}
