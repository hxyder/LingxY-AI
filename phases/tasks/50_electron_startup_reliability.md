# UCA-050 — Electron 启动可靠性修复

**Status**: done  
**Priority**: P0  
**Depends on**: UCA-025  
**Branch**: `task/uca-050-electron-startup`

## 目标

消除 electron-main.mjs 中的 silent 启动失败，让用户明确知道程序是否正常运行。解决"打不开程序"问题。

## 问题根因（代码审计）

1. **Race condition**：`startHandoffWatcher()` / `startNotificationWatcher()` 失败被 silent log，app 报告 "started" 但 UI dead
2. **Silent feature enable**：`isRemoteFeatureEnabled()` 网络错误时默认返回 `true`，本该关闭的功能被默默打开
3. **Hotkey 快速连按**：`captureActiveWindowContext()` 两次并发 promise 竞争，失败时 UI 仍显示成功
4. **Dead window 检测缺失**：`windows` Map 中 dead window 不被清理，`activate` handler 认为 app 正常运行

## 关键修改

### `src/desktop/tray/electron-main.mjs`

1. `startHandoffWatcher()` / `startNotificationWatcher()` 返回明确成功/失败状态：
   - 失败时用 `dialog.showErrorBox()` 提示用户，而不是 `safeError()` silent log
   - 关键 watcher 失败时可选择 graceful quit

2. `isRemoteFeatureEnabled()` 网络错误改为 default-false + retry：
   ```js
   // Before: return true on error (silent enable)
   // After: return false on error, schedule retry after 5s
   ```

3. hotkey handler 加 debounce（100ms）+ abort signal：
   - 防止快速连按触发两个并发 `captureActiveWindowContext()`

4. `windows` Map 存活检测：
   - `activate` handler 中检查 `win.isDestroyed()` 或 `win.webContents.isCrashed()`
   - dead window 从 Map 中移除并重建

## 验证

- `scripts/verify-desktop-shell.mjs` 新增场景：
  - watcher 初始化失败时 app 正确报错（不 silent 启动）
  - hotkey 快速连按不触发并发 promise 竞争
- `npm start` → Electron 启动，dock/overlay/console 全部可见，无 silent error
