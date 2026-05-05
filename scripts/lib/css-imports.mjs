import { readFileSync } from "node:fs";
import path from "node:path";

export function readCssWithImports(root, relativePath, seen = new Set()) {
  const absolutePath = path.join(root, relativePath);
  if (seen.has(absolutePath)) return "";
  seen.add(absolutePath);
  const css = readFileSync(absolutePath, "utf8");
  const dir = path.dirname(relativePath);
  return css.replace(/@import\s+url\(["']?([^"')]+)["']?\);\s*/g, (_match, target) => {
    const child = path.join(dir, target).replace(/\\/g, "/");
    return readCssWithImports(root, child, seen);
  });
}
