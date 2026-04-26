/**
 * UCA-077 P3-01: Connector capability helpers, lifted out of agent-loop.mjs.
 *
 * These map the user's free-text intent ("帮我看一下日历", "查我的邮件") to
 * a generic connector capability key (calendarRead / emailRead / fileRead),
 * then to a callable read tool. The connector planner uses both halves:
 *   1. Ask the connector catalog for a tool with this capability + provider.
 *   2. If the catalog has nothing, fall back to the canonical
 *      account_list_* action tools so older contracts still work.
 */

/**
 * @param {string} text
 * @returns {"calendarRead"|"fileRead"|"emailRead"|null}
 */
export function inferCapabilityFromText(text = "") {
  if (/(日历|\bcalendar\b|event|events|会议|日程)/i.test(text)) return "calendarRead";
  if (/(google\s*drive|onedrive|云端文件|网盘|drive|文件)/i.test(text)) return "fileRead";
  if (/(邮件|邮箱|\bemails?\b|\bmail\b|gmail|outlook)/i.test(text)) return "emailRead";
  return null;
}

/**
 * Turn a connector-catalog tool id into the corresponding action_tool id
 * (e.g. `gmail_list_messages` → `account_list_emails`). Falls back to the
 * canonical account_list_* tool when the catalog tool doesn't declare an
 * `execution.actionTool`.
 *
 * @param {{ getTool?: (id: string) => object }} catalog
 * @param {string} toolId
 * @returns {string|null}
 */
export function pickReadActionToolFromCatalog(catalog, toolId) {
  const tool = catalog?.getTool?.(toolId);
  const actionToolId = tool?.execution?.actionTool;
  if (actionToolId && typeof actionToolId === "string") {
    return actionToolId;
  }
  if (tool?.capability === "calendarRead") return "account_list_events";
  if (tool?.capability === "fileRead") return "account_list_files";
  if (tool?.capability === "emailRead") return "account_list_emails";
  return null;
}

/**
 * @param {"calendarRead"|"fileRead"|"emailRead"|string} capability
 * @returns {string|null}
 */
export function fallbackReadToolForCapability(capability) {
  if (capability === "calendarRead") return "account_list_events";
  if (capability === "fileRead") return "account_list_files";
  if (capability === "emailRead") return "account_list_emails";
  return null;
}
