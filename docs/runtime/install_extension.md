# Browser Extension Install

## Chrome / Edge

1. Open the extensions page.
2. Enable developer mode.
3. Load the `browser_ext/` folder as an unpacked extension.
4. Copy the real unpacked extension IDs for Chrome / Edge.
5. Run `scripts/install-native-host.ps1` and replace the placeholder `allowed_origins` with those IDs if needed.
6. Reload the extension after the Native Host manifest is registered.

## Required Permissions

- `contextMenus`
- `nativeMessaging`
- `activeTab`
- `scripting`
- `storage`

## Runtime Action

- popup 的“打开主控制台”当前会请求 Native Host 打开本地 runtime 的 `/tasks` 页面
- 完整桌面控制台 UI 会在后续 `UCA-018` 接线
