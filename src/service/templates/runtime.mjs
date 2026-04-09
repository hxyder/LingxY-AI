import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TEMPLATES } from "./builtin/index.mjs";
import { normalizeTemplateDocument } from "./parser.mjs";
import { loadTemplateFile } from "./parser.mjs";
import { validateTemplateDocument } from "./schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = path.join(__dirname, "builtin");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function annotateTemplate(template, origin, storage = {}) {
  return {
    ...clone(template),
    template_origin: origin,
    storage
  };
}

function sanitizeTemplateFileName(templateId) {
  return templateId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseStoredTemplate(raw, fallbackOrigin = "user", storage = {}) {
  const parsed = normalizeTemplateDocument(JSON.parse(raw));
  const validation = validateTemplateDocument(parsed);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
  return annotateTemplate(parsed, fallbackOrigin, storage);
}

export async function loadBuiltinTemplates() {
  const files = (await readdir(BUILTIN_DIR))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  return Promise.all(files.map((entry) => loadTemplateFile(path.join(BUILTIN_DIR, entry))));
}

export function createTemplateRegistry(templates = []) {
  const registered = new Map();
  for (const template of templates) {
    registered.set(template.id, clone(template));
  }

  return {
    register(template) {
      registered.set(template.id, clone(template));
      return this.get(template.id);
    },
    get(templateId) {
      return clone(registered.get(templateId) ?? null);
    },
    list() {
      return [...registered.values()].map((entry) => clone(entry));
    }
  };
}

export function createBuiltinTemplateRegistry() {
  return createTemplateRegistry(BUILTIN_TEMPLATES.map((template) => annotateTemplate(template, "builtin")));
}

export function createPersistentTemplateRegistry({
  templatesDir,
  builtinTemplates = BUILTIN_TEMPLATES
}) {
  mkdirSync(templatesDir, { recursive: true });

  const builtinMap = new Map(
    builtinTemplates.map((template) => [
      template.id,
      annotateTemplate(template, "builtin", {
        file_path: null
      })
    ])
  );
  const userMap = new Map();

  for (const entry of readdirSync(templatesDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(templatesDir, entry);
    try {
      const template = parseStoredTemplate(readFileSync(filePath, "utf8"), "user", {
        file_path: filePath
      });
      userMap.set(template.id, template);
    } catch (error) {
      throw new Error(`invalid_user_template:${entry}:${error.message}`);
    }
  }

  function saveUserTemplate(template, actor = "system") {
    const normalized = normalizeTemplateDocument(template);
    const validation = validateTemplateDocument(normalized);
    if (!validation.ok) {
      return {
        ok: false,
        validation
      };
    }

    const filePath = path.join(templatesDir, `${sanitizeTemplateFileName(normalized.id)}.json`);
    const stored = annotateTemplate({
      ...normalized,
      updated_at: new Date().toISOString(),
      updated_by: actor
    }, "user", {
      file_path: filePath
    });

    writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    userMap.set(stored.id, stored);
    return {
      ok: true,
      validation,
      template: clone(stored)
    };
  }

  function getTemplate(templateId) {
    return clone(userMap.get(templateId) ?? builtinMap.get(templateId) ?? null);
  }

  function listTemplates() {
    return [
      ...builtinMap.values(),
      ...userMap.values()
    ].map((template) => clone(template)).sort((left, right) => left.id.localeCompare(right.id));
  }

  return {
    register(template) {
      const result = saveUserTemplate(template);
      if (!result.ok) {
        throw new Error(result.validation.errors.join("; "));
      }
      return result.template;
    },
    save(template, options = {}) {
      return saveUserTemplate(template, options.actor ?? "system");
    },
    import(templateOrRaw, options = {}) {
      if (typeof templateOrRaw === "string") {
        return saveUserTemplate(JSON.parse(templateOrRaw), options.actor ?? "import");
      }
      return saveUserTemplate(templateOrRaw, options.actor ?? "import");
    },
    remove(templateId) {
      const template = userMap.get(templateId);
      if (!template) {
        return null;
      }
      if (template.storage?.file_path) {
        rmSync(template.storage.file_path, { force: true });
      }
      userMap.delete(templateId);
      return clone(template);
    },
    export(templateId) {
      const template = getTemplate(templateId);
      if (!template) {
        return null;
      }
      return JSON.stringify(template, null, 2);
    },
    get(templateId) {
      return getTemplate(templateId);
    },
    list() {
      return listTemplates();
    }
  };
}
