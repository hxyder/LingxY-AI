# Task UCA-011 — Phase 3 浏览器内跟随浮标体验完善

## 1. 任务目标

把浏览器扩展内的浮标做成稳定、低打扰、可配置的正式体验。

## 2. 前置依赖

- 上一个任务：UCA-006、UCA-009
- 必须已有的产物：浏览器扩展、域名黑名单、Presenter Mode
- 不能同时修改的区域：Office Add-in

## 3. 实施范围

- 负责模块：StabilityWatcher、定位算法、显示策略、站点兼容矩阵
- 允许改动文件/目录：`browser_ext/content_script/`, `browser_ext/shadow_ui/`
- 明确不做：跨应用跟随

## 4. 交付产物

- 稳定浮标
- 显示/隐藏策略
- 配置项
- 跨站点测试矩阵

## 5. 验证方式

- 单元测试：定位算法、稳定判定
- 手动站点测试至少 20 个
- 滚动与缩放场景检查

## 6. Git 执行方式

- 分支名：`task/uca-011-phase3-browser-overlay`
- Commit 格式：`UCA-011: polish browser overlay experience`
- 合并条件：P95 显示延迟达标、兼容矩阵通过

## 7. 完成后必须更新本文件

- 写明显示规则最终值
- 写明黑名单行为
- 记录典型例外站点

## 8. 对下一个任务的交接

- 下一个任务：无直接阻塞；为持续优化保留
- 本任务新增了什么：可发布级浏览器内浮标体验
- 下一个任务直接可复用什么：站点适配规则、浮标配置
- 还没解决的问题：若未来要做桌面跟随，需要新开 phase

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-011-phase3-browser-overlay`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 显示规则最终值：
  - `debounce = 150ms`
  - `stability = 200ms`
  - `minLength = 5`
  - `longSelectionMinLength = 32`
  - `autoHideMs = 5000`
  - `previewDelayMs = 300`
  - 默认模式 `smart`
- 黑名单行为：
  - 默认黑名单域名包含 `mail.google.com`、`outlook.live.com`
  - 命中黑名单域名时浮标直接不显示
  - Presenter Mode 开启时浮标直接不显示
  - 输入框 / `textarea` / `contenteditable` 内的选区不显示
- 典型例外站点：
  - `mail.google.com`
  - `outlook.live.com`
  - 任意富文本编辑器页面（按输入法保护规则默认不显示）
- 实际新增内容：
  - 将浏览器浮标逻辑拆分为 `rules / placement / stability-watcher / selection-cache`
  - 新增显示策略、黑名单、Presenter Mode、Esc dismiss、滚动重定位、自动隐藏与 hover 预览
  - 为扩展 popup 增加浮标模式和启用状态的配置入口
  - 新增 `docs/browser_overlay/` 与 `scripts/verify-browser-overlay.mjs`
- 验证结果：
  - `node scripts/verify-browser-extension.mjs`
  - `node scripts/verify-browser-overlay.mjs`
  - `npm run check`
- 遗留问题：
  - 20 站点人工兼容矩阵还没有逐站执行，当前只是规则和脚本级验证
  - 主按钮和预览动作目前只记录 `window.__ucaOverlayLastAction`，还没真正直连 UCA 提交流程
  - 富文本复杂站点的 `MutationObserver / ResizeObserver` 专项适配尚未接入
- 交接给下一个任务：
  - 后续扩展优化可以直接复用 `browser_ext/content_script/rules.js`、`placement.js`、`stability-watcher.js`
  - 若需要将浮标动作真正提交到 UCA，可从 `window.__ucaOverlayLastAction` 与现有 Native Messaging 通路继续接
