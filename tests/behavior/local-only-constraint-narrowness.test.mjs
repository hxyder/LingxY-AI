import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { detect } from "../../src/service/core/intent/signals/local-only-constraint.mjs";

test("local-only constraint matches deictic noun slots without enumerating the noun", () => {
  for (const noun of ["蓝图", "章程", "方案"]) {
    const signal = detect(`仅基于这份${noun}总结`, {});
    assert.equal(signal.matched, true, noun);
    assert.equal(signal.kind, "fact");
    assert.equal(signal.hint?.constraint, "local_only");
  }
});

test("local-only constraint does not turn neutral local evidence into a no-web constraint", () => {
  const signal = detect("结合这份材料搜索外部机会", {});
  assert.equal(signal.matched, false);
});

test("local-only constraint detector does not enumerate sample instance nouns", () => {
  const src = readFileSync(new URL("../../src/service/core/intent/signals/local-only-constraint.mjs", import.meta.url), "utf8");
  assert.ok(!/(简历|resume|合同|蓝图)/i.test(src));
});
