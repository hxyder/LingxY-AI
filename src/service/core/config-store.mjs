import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

export function createRuntimeConfigStore({ configPath, defaults = {} }) {
  const directory = path.dirname(configPath);

  return {
    configPath,
    load() {
      if (!existsSync(configPath)) {
        return JSON.parse(JSON.stringify(defaults));
      }

      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      return deepMerge(defaults, parsed);
    },
    save(config) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      return config;
    },
    patch(nextPatch) {
      const current = this.load();
      const merged = deepMerge(current, nextPatch);
      return this.save(merged);
    }
  };
}
