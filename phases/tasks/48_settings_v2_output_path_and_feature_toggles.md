# Task UCA-048 — 设置 v2：默认文件输出路径 + 功能开关矩阵 + 关闭功能时的引导跳转

## 1. 任务目标

把 Console Settings 从"少数几个表单项"升级到"用户可以集中配置 UCA 的默认行为和启用 / 关闭哪些模块"：
- 新增 "默认输出路径"（所有没有显式目标路径的生成文件落到这里）
- 新增 "功能总开关" 矩阵（翻译 / 语音 / 邮件监测 / 网页内联 / active window probe / 自动搜索 / ...），默认全部开启
- 用户勾掉某个功能后，该功能在 runtime 被屏蔽；如果用户尝试用被关掉的功能，UCA 弹一条提示 + "打开设置" 按钮，点击直接 `shellNavigateConsole` 跳到 Settings 的对应区域

## 2. 前置依赖

- 上一个任务：UCA-018（console settings 基础）、UCA-036（`shellNavigateConsole` IPC）、UCA-034 ~ UCA-047（所有新功能都要能被 toggle）
- 必须已有的产物：`runtime.configStore`、Console Settings Tab、`shellNavigateConsole` IPC 通道
- 不能同时修改的区域：runtime 持久化 schema 主干、安全 broker 基线

## 3. 实施范围

- 负责模块：ConfigStore 扩展、feature flag 模块、Settings Tab UI、功能 gate helper、被屏蔽功能的引导跳转
- 允许改动文件/目录：`src/service/core/config-store.mjs`（扩展现有 ConfigStore）、`src/desktop/renderer/console.html` / `console.js`、`src/desktop/renderer/overlay.js`（加 gate helper）、`src/service/core/service-bootstrap.mjs`、`phases/tasks/`
- 明确不做：多 profile 配置、team-wide 配置、导入 / 导出配置文件（以后再说）

## 4. 交付产物

- **ConfigStore 扩展**：
  ```json
  {
    "output": {
      "defaultDir": "C:\\Users\\<user>\\Documents\\UCA",
      "autoCreateDirs": true
    },
    "features": {
      "translation": { "enabled": true },
      "voice_input": { "enabled": true },
      "email_monitoring": { "enabled": false },
      "morning_digest": { "enabled": false },
      "inline_web_result": { "enabled": true },
      "active_window_probe": { "enabled": true },
      "web_search_fetch": { "enabled": true },
      "multi_intent_decomposition": { "enabled": true },
      "schedule_reminders": { "enabled": true },
      "projects_and_history": { "enabled": true }
    }
  }
  ```
- **Feature flag 模块**：
  - `isFeatureEnabled(featureId): boolean`
  - `requireFeature(featureId): { ok, redirectTabAnchor?: string }`
  - service 端：对每个执行器 / action tool 入口都要先 `requireFeature` 校验
  - overlay 端：在 toolbar 按钮点击和 quick action 入口加 gate —— 被关闭时弹 pop bubble "此功能已在设置里关闭" + "打开设置" 按钮
- **默认输出路径应用**：
  - 所有生成 artifact 的执行器（fast / kimi / multi_modal / translate）检查 `configStore.output.defaultDir`
  - 如果用户的任务里没有显式目标目录 / 文件路径，则输出落到该目录
  - 目录不存在时按 `autoCreateDirs` 自动创建
- **Settings UI 扩展**：
  - 新分组 "默认输出路径"：只读展示 + "浏览" 按钮（用 Electron `dialog.showOpenDialog`）+ "使用 Documents/UCA"
  - 新分组 "功能开关"：一列 feature name + toggle + 简短说明 + "了解更多" 链接（指向对应任务 md）
  - 保存按钮：改动不落地直到点"保存设置"，避免误操作
- **被屏蔽功能的引导跳转**：
  - pop bubble 里的按钮调 `window.ucaShell.navigateConsole({ tabId: "settings", anchor: "features.<id>" })`
  - console.js 收到后 `switchTab("settings")` + `scrollToAnchor("features.<id>")`
- **Console Settings 里 feature flag 区域加锚点**（`id="features.translation"` 等）

## 5. 验证方式

- `node scripts/verify-service-core.mjs`（新增：configStore.output.defaultDir 默认值、`isFeatureEnabled` 单元）
- `node scripts/verify-desktop-renderer.mjs`（新增：Settings Tab 含 feature 开关列表）
- 手动：
  - 关掉 "翻译" → 在 overlay 点翻译 → 看到 pop bubble + "打开设置" → 点击 → Console 打开 + Settings Tab + 滚动到 translation 锚点
  - 设置默认输出目录到 `D:\UCA-out` → 提交一个"写一份周报"任务 → 生成的 .md 出现在 `D:\UCA-out`

## 6. Git 执行方式

- 分支名：`task/uca-048-settings-v2`
- Commit 格式：`UCA-048: settings v2 with feature toggles and default output path`
- 合并条件：
  - 所有已列 features 都能被关闭
  - 关闭后的功能有明确引导
  - 默认输出路径被执行器尊重

## 7. 完成后必须更新本文件

- 列出最终的 feature flag 清单
- 列出默认输出路径的平台差异（Windows vs macOS）
- 列出 gate 校验失败策略（例如 configStore 读失败时是允许还是拒绝）

## 8. 对下一个任务的交接

- 下一个任务：Settings 导入 / 导出、多 profile
- 本任务新增了什么：功能开关矩阵 + 默认输出路径 + 引导跳转
- 下一个任务直接可复用什么：`isFeatureEnabled` / `requireFeature` 接口、ConfigStore schema
- 还没解决的问题：团队共享配置、配置版本控制、命令行参数覆盖配置

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：扩展现有 `src/service/core/config-store.mjs` 为唯一配置源，service 和 renderer 通过同一 schema 读写 output/defaultDir 与 feature flags；功能关闭时在入口层 gate，而不是在各 executor 内部分散判断。
- 当前代码对齐点：Console 已有 Settings tab 和 `shellNavigateConsole` IPC；artifact store / Kimi output-format / fast/multi_modal/translate 生成路径需要统一读取 `configStore.output.defaultDir`。UCA-034 ~ UCA-047 的功能开关要集中登记，默认启用策略也由同一 schema 表达。
- 可能需要生成的文件：通常不新增 service 目录；需要扩展 `src/service/core/config-store.mjs`、`src/desktop/renderer/console.html/js`、`src/desktop/renderer/overlay.js`、相关 executor 的 outputDir 读取点，并更新 `scripts/verify-service-core.mjs` 与 `scripts/verify-desktop-renderer.mjs`。

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题（开工前已识别）：
  - 用户需求（2026-04-11）："用户可以设置程序生成文件的默认存储路径。除非有特定文档，文件，文件夹被提供。"
  - 用户需求（2026-04-11）："设置里默认全部功能开启，用户可以勾选，然后点击保存设置，从而屏蔽某些功能。如果功能屏蔽了，但用户想用，提醒用户到设置里设置，并提供链接，点击进入设置"
  - 要覆盖到 UCA-034 ~ UCA-047 所有新功能，每个任务完成时都要注册对应 feature flag；feature gate 必须集中在配置层和入口层，避免各模块各自做一套开关
- 交接给下一个任务：
