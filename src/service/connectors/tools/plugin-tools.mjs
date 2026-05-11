import { createActionResult } from "../../capabilities/registry/types.mjs";

/**
 * connector_plugin_manage — expose list/enable/disable/reload to the model.
 * install/uninstall intentionally stay out of the model-visible surface —
 * those are user actions performed from the Console UI.
 */
export const CONNECTOR_PLUGIN_MANAGE_TOOL = {
  id: "connector_plugin_manage",
  name: "Connector Plugin Manage",
  description: "List installed connector plugins, enable or disable one, or reload the catalog after user installs a plugin.",
  parameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["list", "enable", "disable", "reload"] },
      pluginId: { type: "string" }
    }
  },
  risk_level: "low",
  required_capabilities: [],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const registry = ctx.runtime?.pluginRegistry;
    if (!registry) {
      return createActionResult({
        success: false,
        observation: "Plugin registry unavailable on this runtime.",
        metadata: { tool_id: "connector_plugin_manage" }
      });
    }
    const action = String(args.action ?? "").trim().toLowerCase();
    try {
      if (action === "list") {
        return createActionResult({
          success: true,
          observation: "Plugin list returned.",
          metadata: { tool_id: "connector_plugin_manage", plugins: registry.list() }
        });
      }
      if (action === "reload") {
        registry.reload();
        return createActionResult({
          success: true,
          observation: "Connector plugin catalog reloaded.",
          metadata: { tool_id: "connector_plugin_manage", plugins: registry.list() }
        });
      }
      if (action === "enable" || action === "disable") {
        if (!args.pluginId) {
          return createActionResult({
            success: false,
            observation: "pluginId required for enable/disable.",
            metadata: { tool_id: "connector_plugin_manage" }
          });
        }
        const plugin = registry.setEnabled(args.pluginId, action === "enable");
        return createActionResult({
          success: true,
          observation: `Plugin ${args.pluginId} ${action === "enable" ? "enabled" : "disabled"}.`,
          metadata: { tool_id: "connector_plugin_manage", plugin }
        });
      }
      return createActionResult({
        success: false,
        observation: `Unknown action: ${action}. Use list, enable, disable, or reload.`,
        metadata: { tool_id: "connector_plugin_manage" }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Plugin action failed: ${error.message}`,
        metadata: { tool_id: "connector_plugin_manage" }
      });
    }
  }
};
