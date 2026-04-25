import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sanitizeProviderConfig, sanitizeTaskRouteForProvider } from "../../shared/provider-catalog.mjs";

function deepMerge(base, patch) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && merged[key]
      && typeof merged[key] === "object"
      && !Array.isArray(merged[key])
    ) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function sanitizeAiConfig(ai = {}) {
  const customProviders = (ai.customProviders ?? []).map((provider) => sanitizeProviderConfig(provider));
  const providerById = new Map(customProviders.map((provider) => [provider.id, provider]));
  const taskRouting = Object.fromEntries(
    Object.entries(ai.taskRouting ?? {}).map(([taskType, route]) => {
      const provider = route?.providerId ? providerById.get(route.providerId) : null;
      return [taskType, sanitizeTaskRouteForProvider(provider, route, taskType) ?? route];
    })
  );
  return {
    ...ai,
    customProviders,
    taskRouting
  };
}

function migrateRuntimeConfig(config = {}) {
  const next = cloneJson(config);
  if (next.ai && typeof next.ai === "object") {
    next.ai = sanitizeAiConfig(next.ai);
  }
  return next;
}

export function createRuntimeConfigStore({ configPath, defaults = {} }) {
  const directory = path.dirname(configPath);

  return {
    configPath,
    load() {
      if (!existsSync(configPath)) {
        return JSON.parse(JSON.stringify(defaults));
      }

      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      const merged = deepMerge(defaults, parsed);
      const migrated = migrateRuntimeConfig(merged);
      if (JSON.stringify(migrated) !== JSON.stringify(merged)) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(configPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
      }
      return migrated;
    },
    save(config) {
      mkdirSync(directory, { recursive: true });
      const migrated = migrateRuntimeConfig(config);
      writeFileSync(configPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
      return migrated;
    },
    patch(nextPatch) {
      const current = this.load();
      const merged = deepMerge(current, nextPatch);
      return this.save(merged);
    }
  };
}
