import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function loadBuiltinJson(filename) {
  return require(`./${filename}`);
}
