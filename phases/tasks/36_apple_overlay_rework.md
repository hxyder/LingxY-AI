# Task UCA-036 — Apple 风格 overlay 重做：快捷动作工具栏、纸飞机发送按钮、pop 气泡、内联表单

## 1. 任务目标

把 UCA-033 的玻璃外观进一步向 Apple HI 靠拢：在输入条上方加一排 quick-action 按钮（翻译 / 总结 / 解释 / 定时 / 语音 / 设置 / 新会话），把发送按钮从"播放三角"换成纸飞机 SVG，引入 Apple 风格的 pop 气泡做短暂反馈（用户不点击则 3 秒自动隐藏），并为"定时任务"提供一个内联表单。

## 2. 前置依赖

- 上一个任务：UCA-033（玻璃 UI 重设计）、UCA-035（语音卡片）
- 必须已有的产物：overlay 气泡会话层、showToast、快捷键链路
- 不能同时修改的区域：service 端任务生命周期、dock / console 布局

## 3. 实施范围

- 负责模块：overlay 工具栏、send 按钮 SVG、pop 气泡、内联定时任务表单、auto-hide 逻辑
- 允许改动文件/目录：`src/desktop/renderer/overlay.html`、`src/desktop/renderer/overlay.js`、`src/desktop/renderer/preload.cjs`、`src/desktop/renderer/console.js`、`src/desktop/tray/electron-main.mjs`、`src/desktop/shared/manifest.mjs`、`scripts/verify-overlay-composer.mjs`、`scripts/verify-desktop-renderer.mjs`
- 明确不做：重做 Dock、重做 Console 布局、重做 notification 窗口

## 4. 交付产物

- Quick toolbar：翻译/总结/解释/定时/语音/设置/新会话 7 个按钮
- 纸飞机 SVG send 按钮（替换 `&#9654;` 三角）
- 内联 schedule form（`#schedulePanel`）：datetime-local + name + textarea + 取消/创建按钮
- Pop bubble（`#popBubble`）：居中短暂气泡，3 秒 auto-hide，用户点击进入"持久"模式
- `shellNavigateConsole` IPC 通道 —— 点击 ⚙️ 跳转 Console 并自动切到 Settings Tab

## 5. 验证方式

- `node scripts/verify-overlay-composer.mjs`（新断言：voiceCard / wave-bar / popBubble / popOpenBtn / schedulePanel / settingsBtn / data-quick-action / SVG / markUserEngaged / QUICK_ACTION_PRESETS / runQuickAction）
- `node scripts/verify-desktop-renderer.mjs`
- 手动：点翻译 → 自动读剪贴板 → 看 pop 气泡结果 → 3 秒自动消失
- 手动：点定时 → 填时间 + 命令 → 创建 → 看 `/schedules` POST 成功

## 6. Git 执行方式

- 分支名：`task/uca-036-apple-overlay-rework`
- Commit 格式：`UCA-036: Apple-style overlay with quick toolbar + pop bubble`
- 合并条件：所有 quick-action 能一键触发且进入 pop 气泡模式；新 send icon 渲染正常；定时表单能真正创建 schedule

## 7. 完成后必须更新本文件

- 列出 quick-action 预设命令
- 列出 pop 气泡的 auto-hide 时长/进入持久模式的触发条件
- 列出 Apple 风格视觉 tokens（模糊半径、圆角、阴影）

## 8. 对下一个任务的交接

- 下一个任务：浏览器内联结果框（UCA-037）使用同一套 Apple tokens 做视觉一致
- 本任务新增了什么：quick-toolbar、pop bubble、内联 panel 范式
- 下一个任务直接可复用什么：CSS 变量、`showPopBubble()` / `markUserEngaged()` 机制
- 还没解决的问题：Dock 仍是旧视觉；notification toast 还没 Apple 化

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - **Quick toolbar** 7 个按钮，inline SVG / Unicode glyph + 中文标签，支持 hover 动效
  - **Send 按钮纸飞机 SVG**：36×36 圆形按钮，hover 时上抬 + 阴影加深，用 `<svg viewBox="0 0 24 24">` 直接画 path
  - **Inline schedule form**（#schedulePanel）：datetime-local 默认 5 分钟后、任务名称、任务内容 textarea、取消 + 创建按钮。提交时用 `type: "at"` 一次性触发器 POST `/schedules`
  - **Pop bubble**（#popBubble）：Apple 深色 frosted glass，`rgba(28,28,30,0.92)` + `backdrop-filter: blur(32px) saturate(180%)`，居中，3 秒 auto-hide
  - **popKeptOpen 状态机**：
    - 每次 `onWindowFocused` 重置为 false（重新唤起 = 短暂模式）
    - 任何 `pointerdown` / `focus` 在 commandInput 或 bubbleArea 上 → `markUserEngaged()` 取消 auto-hide
    - Pop bubble 上的 `展开对话` 按钮也会 `markUserEngaged` 并把内容写入正式气泡
  - **视觉 tokens 升级**：
    - `backdrop-filter: blur(40px) saturate(180%)`（之前 28px / 1.2）
    - 圆角 22px / 32px
    - 字体栈 `-apple-system, "SF Pro Text", "PingFang SC", ...`
    - Transition 用 `cubic-bezier(0.22, 1, 0.36, 1)`
  - **Settings 按钮 + IPC 跳转**：新增 `shellNavigateConsole` IPC 通道，electron-main 收到后 `showWindow('console')` + 转发 `{tabId}` 到 console 渲染进程，console.js 监听并 `switchTab(tabId)`
  - **Hotkey 拆分**：
    - `Ctrl+Shift+U` = `toggle-overlay`（干净打开，不 auto-capture）
    - `Ctrl+Shift+Space` = `capture-and-ask`（显式抓取再打开，保留原行为）
    - `Ctrl+Shift+V` = `voice-wake`（见 UCA-035）
- 验证结果：
  - `node scripts/verify-overlay-composer.mjs` 通过
  - `node scripts/verify-desktop-renderer.mjs` 通过
  - `node scripts/verify-desktop-shell.mjs` 通过
- 遗留问题：
  - Dock 仍是旧视觉
  - Notification toast 还没 Apple 化
  - 内联 schedule form 只支持 at-trigger，cron / interval 仍走控制台
  - **[与 UCA-046 冲突 / 待扩展]** 2026-04-11 新需求：用户希望在内联 schedule form 里能直接选"提前多久通知"（参考 Teams Calendar 的 reminder 选项），并自动按 8h/1d/1w 的时间尺度给出默认提前时间。本任务的 form 当前只有触发时间、名称、内容三项，需要在 UCA-046 里补充 leadTime 下拉
- 交接给下一个任务：
  - UCA-037 的内联结果框复用同一套 frosted-glass + accent 色 tokens
  - `showPopBubble({label, body, autoHideMs})` 是通用短暂反馈入口
  - UCA-046 将在本任务的 `#schedulePanel` 基础上追加 leadTime 选择 + 分类 label 选择
