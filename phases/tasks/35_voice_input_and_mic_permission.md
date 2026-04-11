# Task UCA-035 — 桌面语音输入、麦克风权限与 Siri 风格语音卡片

## 1. 任务目标

让用户在 UCA 桌面端无需打字即可提交任务：按一个快捷键就能唤起语音卡片，说话后按回车直接发送；拒绝非本地 webContents 的麦克风请求以保证隐私。

## 2. 前置依赖

- 上一个任务：UCA-025（Electron windows bootstrap）、UCA-033（玻璃 UI 重设计）
- 必须已有的产物：Electron 主进程、overlay 渲染进程、全局快捷键注册链
- 不能同时修改的区域：service 端任务提交主干

## 3. 实施范围

- 负责模块：Electron 权限处理器、overlay 语音卡片 UI、语音快捷键、错误友好化
- 允许改动文件/目录：`src/desktop/tray/electron-main.mjs`、`src/desktop/renderer/overlay.html`、`src/desktop/renderer/overlay.js`、`src/desktop/shared/manifest.mjs`、`scripts/verify-overlay-composer.mjs`、`scripts/verify-desktop-renderer.mjs`
- 明确不做：自研 ASR、离线语音模型、云端语音 API 接入

## 4. 交付产物

- Electron session permission handler（只允许 file:// / 127.0.0.1 / localhost 的 media / audioCapture / microphone）
- Siri 风格语音卡片（9 根 wave bar CSS 动画，状态 idle/recording/error）
- `Ctrl+Shift+V` 全局快捷键 `voice-wake`：一键打开 overlay + 自动开始监听
- 友好的识别错误映射（not-allowed / service-not-allowed / no-speech / audio-capture / network / aborted）

## 5. 验证方式

- `node scripts/verify-desktop-renderer.mjs`（新增 setPermissionRequestHandler / setPermissionCheckHandler 断言）
- `node scripts/verify-overlay-composer.mjs`（新增 voiceCard / wave-bar / voiceTranscript 断言）
- 手动：`Ctrl+Shift+V` → 看到波形动画 → 说话 → 看到实时 transcript → 回车发送

## 6. Git 执行方式

- 分支名：`task/uca-035-voice-input`
- Commit 格式：`UCA-035: add voice input with Apple-style voice card`
- 合并条件：点击麦克风不再显示 `not-allowed`；快捷键一键触达；无效/错误状态有友好中文提示

## 7. 完成后必须更新本文件

- 列出支持的识别语种
- 列出错误码 → 中文的映射表
- 列出已知的 Web Speech API 边界（Chromium 版本 / 网络依赖）

## 8. 对下一个任务的交接

- 下一个任务：Apple 风格 overlay 重做（UCA-036）在同一 toolbar 上加入 🎤 语音按钮入口
- 本任务新增了什么：完整的语音卡片 UI + 权限授予 + 快捷键
- 下一个任务直接可复用什么：`voiceCard` DOM 结构、`enterVoiceMode/exitVoiceMode`、`startVoiceRecognition`
- 还没解决的问题：离线语音、长时间听写、语种自动切换

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - **Electron 权限处理器**（[electron-main.mjs](../../src/desktop/tray/electron-main.mjs)）：`app.whenReady()` 后立即注册 `session.defaultSession.setPermissionRequestHandler` + `setPermissionCheckHandler`，只放行 `file://` / `http://127.0.0.1` / `http://localhost` 请求的 `media` / `audioCapture` / `microphone` 权限
  - **Siri 风格语音卡片**（[overlay.html](../../src/desktop/renderer/overlay.html)）：
    - 居中 frosted-glass card，圆角 32px，drop shadow
    - 9 根 `wave-bar` 对称分布，CSS keyframe `wave-pulse` + 阶梯延迟，由内向外脉动
    - 状态：`.idle`（暂停+暗淡）/ 正常（动画运行）/ `.error`（红色暂停）
    - 实时 transcript 显示在胶囊背景里
    - 语种下拉（中/英/日/韩）
    - 三个按钮：取消 / 停止 / 开始
  - **overlay.js 语音流程**：
    - `ensureVoiceRecognizer()` 懒加载 Web Speech API，`continuous:false, interimResults:true`
    - `startVoiceRecognition()` 调用 `recognizer.start()`，设置 `recognizer.lang`
    - `result` 事件实时写入 commandInput + voiceTranscript
    - `end` 事件自动切回 idle 状态
    - `error` 事件根据 code 映射到友好中文：
      - `not-allowed` → "麦克风权限被拒绝。请重启 UCA 桌面端，并在系统设置中允许麦克风访问。"
      - `service-not-allowed` → "操作系统拒绝了语音识别服务。请检查系统设置 → 隐私 → 语音识别。"
      - `no-speech` → "没有检测到语音，请再试一次。"
      - `audio-capture` → "无法读取麦克风音频。请检查麦克风是否连接或被其他程序占用。"
      - `network` → "语音识别需要联网；请检查网络后重试。"
      - `aborted` → "语音输入已取消。"
    - 同步 `start()` 抛错分支也做同样的映射
  - **全局键盘流程**：在 voice mode 下绑定 document keydown，Enter 退出 voice + 提交任务，Esc 取消
  - **新增 `voice-wake` 快捷键**（[manifest.mjs](../../src/desktop/shared/manifest.mjs)）：`Ctrl+Shift+V` → electron-main 收到后 `showWindow('overlay')` + `IPC_CHANNELS.shortcutTriggered` → overlay.js 的 `onShortcutTriggered` 看到 `voice-wake` 自动调用 `openVoicePanel({ autoStart: true })`
- 验证结果：
  - `node scripts/verify-desktop-renderer.mjs` 通过（新断言 `setPermissionRequestHandler` / `setPermissionCheckHandler`）
  - `node scripts/verify-overlay-composer.mjs` 通过（新断言 `voiceCard` / `wave-bar` / `voiceTranscript` / `enableStickyFollowUp`→`conversationState` / `voice-wake` / `not-allowed`）
  - `node scripts/verify-desktop-shell.mjs` 通过
- 遗留问题：
  - Web Speech API 在 Electron Chromium 里需要联网（Google 语音识别服务）；内网断网环境当前会 fallback 到 `network` 错误
  - 长时间听写会因为 `continuous:false` 在一段静默后自动结束 —— 当前设计是有意为之（发送节奏），长听写需要另开一个 mode
  - 只支持 4 种语言下拉，其他语种需要手动切换 `recognizer.lang`
- 交接给下一个任务：
  - UCA-036（Apple overlay 重做）把 🎤 按钮塞进 quick-toolbar；点击 = `openVoicePanel({ autoStart: true })`
  - `enterVoiceMode` / `exitVoiceMode` 是状态机入口，后续功能直接调用即可
