import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PPTX_PROVIDER } from "../src/service/preview/providers/pptx.mjs";
import { createPreviewRegistry } from "../src/service/preview/registry.mjs";
import { BUILTIN_PREVIEW_PROVIDERS } from "../src/service/preview/providers/index.mjs";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-pptx-"));

async function buildFixture() {
  const pptxgenMod = await import("pptxgenjs");
  const PptxGen = pptxgenMod.default ?? pptxgenMod;
  const pres = new PptxGen();
  const s1 = pres.addSlide();
  s1.addText("Hello PPTX", { x: 1, y: 1, w: 5, h: 1, fontSize: 32, bold: true });
  s1.addText("A coordinate-preview bullet line", { x: 1, y: 2, w: 5, h: 0.5 });
  const s2 = pres.addSlide();
  s2.addText("Second slide heading", { x: 1, y: 1, w: 5, h: 1 });
  s2.addText("Another point to extract", { x: 1, y: 2, w: 5, h: 0.5 });
  const out = path.join(tmpRoot, "deck.pptx");
  await pres.writeFile({ fileName: out });
  return out;
}

const pptxPath = await buildFixture();

{
  const result = await PPTX_PROVIDER.render({
    filePath: pptxPath,
    ext: ".pptx",
    mime: null,
    runtime: {},
    cacheDir: path.join(tmpRoot, "cache")
  });
  assert.equal(result.kind, "html", "pptx preview must produce html");
  const slideMatches = result.html.match(/class="pptx-slide"/g) ?? [];
  assert.ok(slideMatches.length >= 2, `expected ≥2 .pptx-slide divs, got ${slideMatches.length}`);
  assert.ok(result.html.includes("Hello PPTX") || result.html.includes("Second slide heading"));
  assert.ok(/position:absolute/.test(result.html), "shapes must be absolutely positioned");
  assert.equal(result.meta?.via, "jszip-coords");
}

{
  const registry = createPreviewRegistry({
    providers: BUILTIN_PREVIEW_PROVIDERS,
    cacheDir: path.join(tmpRoot, "cache2"),
    runtime: {}
  });
  assert.ok(registry.list().some((p) => p.id === "pptx"), "pptx provider listed");
  const result = await registry.render(pptxPath);
  assert.equal(result.kind, "html", "registry routes pptx through PPTX_PROVIDER");
}

rmSync(tmpRoot, { recursive: true, force: true });
console.log("ok verify-preview-pptx");
