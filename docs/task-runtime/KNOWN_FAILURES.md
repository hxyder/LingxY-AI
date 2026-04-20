# Known Repo Verification Failures

当前记录的是 **与 Connector/MCP/workflow 框架升级无关** 的仓库既有验证问题。这里保留它们，是为了避免把已有品牌迁移/打包问题误判成 connector 框架回归。

## 1. `verify-office-base.mjs` — UCA→LingxY 字面量遗留

**类别**: verify 脚本断言与实际代码不符
**发现时间**: 2026-04-19，运行 `npm run check` 时
**触发命令**: `node scripts/verify-office-base.mjs`
**错误**:
```
AssertionError: Expected values to be strictly equal:
+ actual: 'LingxY for Word'
- expected: 'UCA for Word'
    at scripts/verify-office-base.mjs:157:8
```

**根因**: 仓库从 `UCA` 更名为 `LingxY`，但 `verify-office-base.mjs` 在 line 157 仍断言 `"UCA for Word"`。已确认在本分支第一次 checkout 后、未做任何改动时就已失败（`git stash` 再跑复现）。

**建议修复**: 把 `verify-office-base.mjs` 里所有 `UCA for ...` 改为 `LingxY for ...`。可能涉及的文件：`verify-office-base.mjs`、`verify-release-readiness.mjs` 里的相同字面量。

---

## 2. `verify-release-readiness.mjs` — 依赖 trial-bundle 产物 + UCA 字面量

**类别**: verify 脚本依赖未构建的产物
**发现时间**: 2026-04-19，全量回归时
**触发命令**: `node scripts/verify-release-readiness.mjs`
**错误**:
```
AssertionError: existsSync(checkCmdPath) === false
    at scripts/verify-release-readiness.mjs:73:8
```

**根因**:
- 脚本断言 `build/trial-package/Check UCA Desktop Trial.cmd` 存在
- 该 bundle 需要先运行 `npm run build:trial-package` 生成
- 即使生成了，产物名含 `UCA` 而 LingxY 品牌已改名
- 同样在本分支第一次 checkout 后、零改动时就已失败

**建议修复**: 选择下列之一：
- (a) 把 verify-release-readiness.mjs 里的 `UCA` 字面量改为 `LingxY`，并让脚本在 bundle 缺失时跳过而非失败
- (b) 更新 `scripts/build-trial-package.mjs` 生成 `LingxY` 命名的产物
- (c) 把它从 `npm run check` 的核心流程里剥离到单独的 `npm run verify:release`

---

## 3. `verify-pdf-ocr.mjs` — 截图默认 userCommand 不再走 multi_modal

**类别**: 默认 userCommand 未触发 vision-analysis 分支
**发现时间**: 2026-04-19，运行 UCA-096 回归时
**触发命令**: `node scripts/verify-pdf-ocr.mjs`
**错误**:
```
AssertionError: screenshotTask.task.context_packet.selection_metadata.image_source === 'screenshot'
    at scripts/verify-pdf-ocr.mjs:210:8 (actual: undefined)
```

**根因**: UCA-095 在 `image-submission.mjs` 加了 `looksLikeVisionAnalysisIntent()`：非分析类命令从 `multi_modal` 改走 `tool_using`，context_packet 变为 `source_type:"file"` 且不再写 `selection_metadata.image_source`。而 `submitScreenshotTask` 的默认 `userCommand` 是 `"请总结这张截图"`，其中 `总结` 没在 VISION_ANALYSIS_RE 里，所以截图任务也被重路由，测试断言失效。

**建议修复**: 选择下列之一：
- (a) 在 VISION_ANALYSIS_RE 加上 `总结|summarize|summarise`（截图/图片的 "总结" 就是视觉分析）
- (b) 改 `submitScreenshotTask` 默认 userCommand 为 `"请描述这张截图"`（触发 `描述`）
- (c) 改 verify 脚本：当路由到 tool_using 时放宽断言

---

## 追踪表

| ID | 脚本 | 根因 | 建议归属 | 状态 |
|---|---|---|---|---|
| KF-1 | `verify-office-base.mjs` | 字面量 UCA→LingxY | release/branding cleanup | NOT_STARTED |
| KF-2 | `verify-release-readiness.mjs` | bundle 依赖 + 字面量 | release/branding cleanup | NOT_STARTED |
| KF-3 | `verify-pdf-ocr.mjs` | UCA-095 引入的 VISION_ANALYSIS_RE 未覆盖 `总结` | 截图 UX cleanup | NOT_STARTED |
