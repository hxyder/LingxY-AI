# Browser Extension Install

## Chrome / Edge

Use `Console -> Settings -> One-click Setup -> Browser Extension -> Configure`.

The desktop setup action:

1. Registers the Native Messaging host for Chrome and Edge.
2. Uses the extension's stable unpacked ID
   `oegpgmnonnejpkgpjmpnbnjlpfmkojkf`.
3. Opens the Chrome / Edge extensions page.
4. Reveals the packaged `browser_ext/` folder.

Chrome and Edge do not allow a normal desktop app to silently load an unpacked
extension. After clicking Configure, enable developer mode in the browser and
load the revealed `browser_ext/` folder as an unpacked extension. No extension
ID copy/paste is needed.

For script-only setup, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -OpenExtensionPage -OpenExtensionFolder
```

Pass `-Browser chrome` or `-Browser edge` to configure only one browser.

## Required Permissions

- `contextMenus`
- `nativeMessaging`
- `activeTab`
- `scripting`
- `storage`

## Runtime Action

- popup 的“打开主控制台”当前会请求 Native Host 打开本地 runtime 的 `/tasks` 页面
- 完整桌面控制台 UI 会在后续 `UCA-018` 接线
