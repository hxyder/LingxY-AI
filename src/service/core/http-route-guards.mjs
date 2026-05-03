import { sendJson } from "./http-helpers.mjs";

export const DESKTOP_ACTOR_HEADER = "x-lingxy-desktop-actor";

const DEFAULT_DESKTOP_ACTORS = new Set([
  "desktop_console",
  "desktop_overlay",
  "desktop_shell",
  "popup_card"
]);

function readHeader(request, name) {
  const lowerName = name.toLowerCase();
  const headers = request?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return `${headers.get(name) ?? headers.get(lowerName) ?? ""}`.trim();
  }
  return `${headers[lowerName] ?? headers[name] ?? ""}`.trim();
}

export function getDesktopActor(request) {
  return readHeader(request, DESKTOP_ACTOR_HEADER).toLowerCase();
}

export function requireDesktopActor({
  request,
  response,
  allowedActors = DEFAULT_DESKTOP_ACTORS
} = {}) {
  const actor = getDesktopActor(request);
  const allowed = allowedActors instanceof Set
    ? allowedActors
    : new Set(Array.isArray(allowedActors) ? allowedActors : []);
  if (!actor || !allowed.has(actor)) {
    sendJson(response, 403, {
      ok: false,
      error: "desktop_actor_required",
      message: "This local mutation must be initiated by the LingxY desktop shell."
    });
    return null;
  }
  return actor;
}
