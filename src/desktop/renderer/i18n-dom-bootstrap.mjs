import { installLingxyI18nControls } from "./i18n-dom.mjs";

if (document.body) {
  installLingxyI18nControls();
} else {
  window.addEventListener("DOMContentLoaded", () => installLingxyI18nControls(), { once: true });
}
