import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TEMPLATES } from "./builtin/index.mjs";
import { loadTemplateFile } from "./parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = path.join(__dirname, "builtin");

export async function loadBuiltinTemplates() {
  const files = (await readdir(BUILTIN_DIR))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  return Promise.all(files.map((entry) => loadTemplateFile(path.join(BUILTIN_DIR, entry))));
}

export function createTemplateRegistry(templates = []) {
  const registered = new Map();
  for (const template of templates) {
    registered.set(template.id, template);
  }

  return {
    register(template) {
      registered.set(template.id, template);
      return template;
    },
    get(templateId) {
      return registered.get(templateId) ?? null;
    },
    list() {
      return [...registered.values()];
    }
  };
}

export function createBuiltinTemplateRegistry() {
  return createTemplateRegistry(BUILTIN_TEMPLATES);
}
