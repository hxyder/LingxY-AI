# Notifications (UCA-182 Phase 8)

As of Phase 8 there is exactly one in-app notification surface: the
top-right popup-card stack. This document explains what rendered it
obsolete and how to add a new card kind.

## Pre-Phase-8 history (retired)

Three surfaces coexisted:

| Surface            | Location            | Retired in Phase 8 |
|--------------------|---------------------|--------------------|
| `#resultToast`     | overlay bottom-center | Yes |
| `notification` window | separate BrowserWindow | Yes (window + file deleted) |
| popup-card          | floating top-right  | Kept as the only one |

The split was confusing (artifact-complete sometimes produced two
cards) and duplicated style rules. Everything now flows through
[src/desktop/tray/popup-card-manager.mjs](../../src/desktop/tray/popup-card-manager.mjs).

## Architecture

```
renderer (overlay/console)
   └─ window.ucaShell.showPopupCard(payload) ──IPC─▶ popup-card-manager
                                                        │
                                                        ▼
                                               new BrowserWindow
                                               loading popup-card.html
                                                        │
                                                        ▼
                                               popup-card.js applyInit()
                                                        │
                                                   user clicks button
                                                        │
                                                        ▼
                                        resolvePopupCard(cardId, meta)
                                                        │
                                                        ▼
                                    electron-main onResolve callback
                                                        │
                                                        ▼
                         overlay webContents.send("uca:popup-card-resolved")
                                                        │
                                                        ▼
                                       overlay.js onPopupCardResolved
                                       dispatches by kind + action
```

## Card kinds

Defined in [popup-card.js](../../src/desktop/renderer/popup-card.js)
(switch in `applyInit`). Each kind has a header colour, default title,
and button set.

| kind          | dot colour | use case                                           | actions |
|---------------|-----------|-----------------------------------------------------|---------|
| `info`        | indigo    | generic notice (default for `ucaShell.notify()`)    | 好 |
| `approval`    | amber     | tool-approval request                               | 拒绝 / 查看详情 / 通过 |
| `success`     | green     | task complete with optional artifact                | 预览 / 打开文件夹 / 复制 / 继续追问 |
| `error`       | red       | task failed                                         | 查看日志 / 查看详情 / 关闭 |
| `libreoffice` | blue      | offer to install LibreOffice via winget             | 用文本预览 / 手动安装 / 自动安装 (winget) |

A per-kind 2-px tint strip at the top of the card reinforces the kind
when multiple cards stack (see [popup-card.css](../../src/desktop/renderer/popup-card.css)).

## success payload shape

```js
{
  kind: "success",
  title: "任务完成",
  lines: ["报告已生成。"],        // body; array or string
  artifactPath: "C:/…/out.docx",  // optional; enables 预览 / 打开文件夹 / 复制
  inlinePreview: "短摘要",         // optional; 复制 uses this if present
  taskId: "task_…",               // forwarded to 继续追问
  allowContinue: true,            // set false to hide 继续追问
  autoHideMs: 10000,
  dedupeKey: "artifact:C:/…/out.docx"  // optional; re-surface instead of stacking
}
```

Resolving maps to overlay.js's
[`onPopupCardResolved` listener](../../src/desktop/renderer/overlay.js)
which dispatches:

| action    | meta                        | overlay action |
|-----------|-----------------------------|----------------|
| preview   | artifactPath, mime          | `livePreview.openForFile({ filePath, mime })` |
| reveal    | artifactPath                | `window.ucaShell.showItemInFolder(path)` |
| copy      | inlinePreview, artifactPath | `writeClipboardText(inlinePreview ?? path)` |
| continue  | taskId                      | focus composer + `maybeRevealOverlay()` |

## Stacking / pin / dedupe

- popup-card-manager stacks cards down from `{workArea.x + width - 420 - 16, workArea.y + 16}`.
- `MAX_CARDS = 5`; oldest non-pinned card is evicted when a new one arrives above the limit.
- `dedupeKey` re-uses an existing card instead of creating a new one. Built-in dedupe for `approval:<approvalId>`, `success:<taskId>`, `error:<taskId>`.
- Pinning (pin icon in the header) disables auto-hide and exempts the card from eviction.

## Adding a new kind

1. Add a `kind === "your_kind"` branch to `applyInit` in popup-card.js.
2. Add dot color and (optional) border-top tint in popup-card.css.
3. For button callbacks, prefer `resolveCard("action_name", meta)` and handle the dispatch in `onPopupCardResolved` inside overlay.js / console.js.
4. If the kind needs dedupe, add a rule in `popup-card-manager.mjs` `dedupeKey()`.

## Legacy compat

`IPC_CHANNELS.shellNotificationReceived` and
`window.ucaShell.onNotificationReceived` still exist but nothing
publishes to them. `WINDOW_IDS.notification` is a named constant with
no registered window. They're kept to avoid breaking any external
consumer; remove when you're confident nothing else references them.
