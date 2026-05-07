/*
 * icons.mjs — Lucide SVG subset for LingxY desktop
 *
 * One inline-SVG per icon, all using stroke="currentColor" so they pick up
 * the theme's --accent automatically. Every icon is Lucide (lucide.dev) at
 * 24×24 viewBox; size is controlled by the consumer via width/height or
 * inherited em/px.
 *
 * Usage:
 *   element.innerHTML = icon("mic");                 // default 16×16
 *   element.innerHTML = icon("calendar", 20);        // explicit size
 *   element.innerHTML = `<button aria-label="Send">${icon("send")}</button>`;
 *
 * The LOGO_MARK export is the LingxY brand mark kept in the same
 * module so everything visual lives in one place.
 */

const BASE_ATTRS = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** Each entry is the inner SVG (children of <svg>), in Lucide 24×24 space. */
const PATHS = Object.freeze({
  check: '<polyline points="20 6 9 17 4 12"/>',
  "check-circle": '<circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  "x-circle": '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  "alarm-clock": '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  "edit-2": '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  "edit-3": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  "trash-2": '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  paperclip: '<path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.98 8.83l-8.49 8.49a2 2 0 1 1-2.83-2.83l7.07-7.07"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "file-text": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>'
});

/**
 * @param {keyof typeof PATHS} name
 * @param {number} [size=16]
 * @returns {string} inline SVG markup
 */
export function icon(name, size = 16) {
  const body = PATHS[name];
  if (!body) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${BASE_ATTRS} aria-hidden="true">${body}</svg>`;
}

/** The LingxY brand mark (right-arrow on a rounded-black-square wrapper).
 *  Mirrors src/desktop/assets/logo/lingxy-mark.svg geometry. */
export const LOGO_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><image href="data:image/png;base64,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" width="32" height="32" preserveAspectRatio="xMidYMid meet"/></svg>`;

/** Enumerate available names for verify / tooling. */
export function listIconNames() {
  return Object.keys(PATHS);
}
