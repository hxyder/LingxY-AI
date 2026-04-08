# Phase 3 — 浏览器内跟随浮标（限定范围）

> 周期估计：W?? · 角色：1 前端
> 上一阶段：[Phase 2.5](phase_2_5_privacy_security.md) · 下一阶段：[Phase 4](phase_4_office_integration.md)
>
> 本 Phase 的范围已经正式收缩为：**只在浏览器扩展内实现跟随浮标**，不做跨应用 Win32 全局选区跟随。原因是浏览器场景价值最高、实现最稳，Office 与 PDF 由后续专属入口覆盖。

## 1. 目标

让 Phase 1c 的浮标更"接近 Grammarly 体验"：

- 选区附近显示，不挡内容
- 不乱闪、不抖动
- 上下文稳定后才出现
- 用户主动行为后立刻出现，被动事件下保守
- 浮标本身不抢焦点

## 2. 范围

### 2.1 必做

| # | 功能 | 范围 |
|---|---|---|
| 1 | 浮标定位算法 | 选区右下方 +16px，超界翻转 |
| 2 | 去抖与节流 | selection 事件 150ms 去抖 |
| 3 | 上下文稳定判定 | 选区不变 200ms 才显示 |
| 4 | hover 预览 | 鼠标悬停浮标 300ms 预览动作 |
| 5 | 滚动跟随 | 浮标随选区位置滚动 |
| 6 | 点击外部消失 | 简单 |
| 7 | Esc 隐藏本轮 | 同选区不再出现，直到选区变化 |
| 8 | 显示策略可配置 | 关闭浮标 / 仅手动模式 / 仅长选区模式 |
| 9 | 浮标 A/B Slot | 文本选区一个 slot，链接/图片右键另一个 slot |
| 10 | 输入法保护 | 浮标 hover 不抢键盘焦点 |

### 2.2 不做

- 跨应用跟随（**永久放弃**）
- Win32 全局选区监听
- Electron 应用内浮标
- Office 内浮标（Phase 4 用 Office Add-in 自己的 Task Pane）
- PDF 内浮标
- 屏幕兜底视觉浮标

## 3. 架构

### 3.1 组件图

```
┌─────────────────────────────────────────────┐
│  Browser Page                                │
│  ┌────────────────────────────────────────┐ │
│  │  Content Script                         │ │
│  │  ┌────────────┐  ┌──────────────────┐  │ │
│  │  │ Selection  │→ │ StabilityWatcher │  │ │
│  │  │ Listener   │  └──────────────────┘  │ │
│  │  └────────────┘            │           │ │
│  │                            ▼           │ │
│  │                  ┌──────────────────┐  │ │
│  │                  │ FloatingButton   │  │ │
│  │                  │ (Shadow DOM)     │  │ │
│  │                  └──────────────────┘  │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 3.2 关键算法

**StabilityWatcher**:

```typescript
class StabilityWatcher {
  private timer: number | null = null;
  private lastSelection: string = '';
  private STABILITY_MS = 200;

  onSelectionChange(text: string) {
    if (text === this.lastSelection) return;
    this.lastSelection = text;
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.shouldShow(text)) this.emit('stable', text);
    }, this.STABILITY_MS);
  }

  shouldShow(text: string): boolean {
    if (text.length < 5) return false;
    if (this.dismissed.has(text)) return false;
    if (settings.minLength && text.length < settings.minLength) return false;
    return true;
  }
}
```

**定位算法**:

```typescript
function placeFloatingButton(range: Range): {x: number, y: number} {
  const rect = range.getBoundingClientRect();
  let x = rect.right + window.scrollX + 16;
  let y = rect.bottom + window.scrollY + 8;
  // 翻转
  if (x + BTN_W > document.documentElement.clientWidth) x = rect.left + window.scrollX - BTN_W - 16;
  if (y + BTN_H > document.documentElement.clientHeight + window.scrollY) y = rect.top + window.scrollY - BTN_H - 8;
  return {x, y};
}
```

### 3.3 显示规则汇总

| 触发 | 是否显示 | 备注 |
|---|---|---|
| 选区 < 5 字 | 否 | |
| 选区刚变（< 200ms 内）| 否 | 等待稳定 |
| 用户上次按 Esc 隐藏 | 否 | 直到选区变化 |
| 该域名在黑名单 | 否 | 来自 Phase 2.5 |
| 当前在输入框/textarea 内选中 | 否 | 避免干扰打字 |
| 屏幕共享中 | 否 | 来自 Phase 2.5 |
| 已显示了 5 秒未交互 | 自动隐藏 | |
| 用户在浮标上 hover | 显示动作面板 | |

## 4. 流程设计

### 4.1 选区→稳定→显示

```
selectionchange (raw)
  → debounce 150ms
  → check basic length
  → StabilityWatcher.onSelectionChange
    → wait 200ms
    → still same?
      yes → emit 'stable'
        → check rules (Esc dismissed? blocklist? input field?)
          pass → place button → render
          fail → no-op
      no → reset
```

### 4.2 浮标交互

```
浮标可见 →
  hover 300ms → 展开动作面板（4-6 个常用动作 + 输入框）
  click 主按钮 → 默认动作 = "总结" → 直接发任务
  click 输入框 → 不抢焦点，但允许打字（用 contenteditable shadow root）
  click 外部 → 收起
  Esc → 收起 + 标记 dismissed
```

### 4.3 滚动跟随

`scroll` 事件用 rAF 节流，每帧最多重定位一次。如果选区滚出视口，浮标自动隐藏。

## 5. 验收标准

### 5.1 功能验收
- [ ] 选中 ≥ 5 字 → 200ms 后浮标稳定显示
- [ ] 200ms 内取消选择 → 浮标不显示
- [ ] 浮标定位不会被滚动错位
- [ ] hover 浮标 300ms 展开动作面板
- [ ] Esc 收起且本选区不再出现
- [ ] 输入框内选中不显示
- [ ] 黑名单域名不显示
- [ ] 屏幕共享中不显示
- [ ] 浮标点击不抢页面焦点
- [ ] 主流网站（GitHub/Wiki/医学论文/微信公众号）无明显错位

### 5.2 性能验收
- [ ] selection→稳定→显示总延迟 ≤ 400ms（P95）
- [ ] 滚动时浮标重定位 60fps 平滑
- [ ] 内容脚本注入 ≤ 50ms

### 5.3 工程验收
- [ ] 单测：StabilityWatcher、定位算法（边界情况）
- [ ] 跨站点测试矩阵：≥ 20 个流量站点逐一过
- [ ] 文档：显示规则表、配置项说明

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 现代 SPA 选区位置不准 | 浮标错位 | 监听 ResizeObserver + MutationObserver 重新定位 |
| 网站 CSP 拦截 Shadow DOM | 浮标不显示 | 失败时降级到右键菜单 |
| 用户觉得浮标干扰 | 流失 | 提供"长选区才显示" "完全关闭" 三档 |
| Esc 与网站快捷键冲突 | 用户按 Esc 触发其它行为 | 用 capture 阶段先吞 Esc |
| 频繁选区造成性能问题 | 页面卡 | 严格 debounce + rAF 节流 |
| 不同 zoom 级别定位偏差 | 位置不对 | 用 visualViewport 修正 |

## 7. 交付物清单

```
browser_ext/
  ├─ content_script/
  │   ├─ stability_watcher.ts
  │   ├─ floating_button/
  │   ├─ placement.ts
  │   └─ rules.ts
docs:
  show_rules_reference.md
  cross_site_test_matrix.md
  phase_3_demo.mp4
```

## 8. 与下一 Phase 的接口

Phase 3 完成后，浏览器内的"接近选区"体验已经完整。Phase 4 起，**Office 用 Office Add-in 自己的 Task Pane 而不是悬浮窗**，因为 Office 的 UI 模式有自己的规则。
