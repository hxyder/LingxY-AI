# UCA Figma Design System Rules

> 本文档供 Figma MCP（Model Context Protocol）在将 Figma 设计稿转换为 UCA 代码时使用。
> 描述了项目的 Design Token 结构、组件体系、样式方法、图标系统及项目结构。

---

## 1. Design Token Definitions

### 1.1 Token 位置

所有设计 Token 以 **CSS Custom Properties** 形式定义在：

```
src/desktop/renderer/shared.css  ← 唯一 token 文件，所有界面共用
```

不存在 JSON token 文件、Style Dictionary 或 Tailwind config —— token 直接以原生 CSS 变量写入，在 `:root` 作用域下全局可用。

### 1.2 Token 完整清单

```css
:root {
  /* ── 背景层级 ── */
  --bg-0: #f5f6f8;
  --bg-1: #ebedf2;
  --bg-2: #e0e3ea;

  /* ── Glass 表面（rgba，用于 backdrop-filter 场景） ── */
  --surface:        rgba(255, 255, 255, 0.72);
  --surface-strong: rgba(255, 255, 255, 0.88);
  --surface-soft:   rgba(255, 255, 255, 0.48);
  --surface-dark:   rgba(22, 24, 30, 0.88);
  --glass:          rgba(255, 255, 255, 0.62);
  --glass-border:   rgba(255, 255, 255, 0.36);

  /* ── 文字 ── */
  --ink:      #1a1d24;
  --ink-soft: #3a3f4b;
  --muted:    #6b7280;

  /* ── 边框 ── */
  --line:        rgba(0, 0, 0, 0.08);
  --line-strong: rgba(0, 0, 0, 0.14);

  /* ── Accent 主色（蓝紫） ── */
  --accent:       #6366f1;
  --accent-strong:#4f46e5;
  --accent-soft:  rgba(99, 102, 241, 0.12);
  --teal-soft:    rgba(20, 184, 166, 0.10);

  /* ── 语义色 ── */
  --success: #10b981;
  --warning: #f59e0b;
  --danger:  #ef4444;

  /* ── 阴影 ── */
  --shadow-xl: 0 25px 60px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 8px  24px rgba(0, 0, 0, 0.06);
  --shadow-sm: 0 2px  8px  rgba(0, 0, 0, 0.04);

  /* ── 圆角 ── */
  --radius-xl:   24px;
  --radius-lg:   16px;
  --radius-md:   12px;
  --radius-sm:   8px;
  --radius-pill: 999px;

  /* ── 字体 ── */
  --font-display: "Segoe UI Variable Display", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-text:    "Segoe UI Variable Text",    "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono:    "Cascadia Code", Consolas, monospace;
}
```

### 1.3 Token 使用规则

当从 Figma 提取颜色时，映射规则如下：

| Figma 颜色 | CSS Token |
|---|---|
| `#6366f1` / Indigo-500 | `var(--accent)` |
| `#4f46e5` / Indigo-600 | `var(--accent-strong)` |
| `rgba(99,102,241,0.12)` | `var(--accent-soft)` |
| `#1a1d24` | `var(--ink)` |
| `#6b7280` | `var(--muted)` |
| `rgba(0,0,0,0.08)` | `var(--line)` |
| `rgba(255,255,255,0.72)` | `var(--surface)` |
| `#10b981` | `var(--success)` |
| `#f59e0b` | `var(--warning)` |
| `#ef4444` | `var(--danger)` |

**禁止**在组件代码里写裸十六进制色值，必须引用 CSS 变量。

---

## 2. Component Library

### 2.1 架构说明

**没有组件框架**（无 React / Vue / Svelte）。

组件以 **原生 HTML + 原生 JavaScript** 实现，每个界面是一个独立 HTML 文件 + 对应 JS 文件：

```
src/desktop/renderer/
├── shared.css          ← 全局 token + 原子类
├── overlay.html/.js    ← 悬浮对话框（主交互界面）
├── dock.html/.js       ← 浮窗图标（Canvas Orb）
├── console.html/.js    ← 控制台（设置/历史/任务）
├── notification.html/.js ← 系统通知 Toast
└── preload.cjs         ← Electron contextBridge（IPC 桥）
```

### 2.2 "组件"的实现模式

组件以**函数返回 HTML 字符串**注入 DOM，例如：

```js
// 气泡组件
function addBubble(role, text, opts = {}) {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = text;
  bubbleArea.appendChild(el);
}

// 任务列表项
function renderTaskItem(task) {
  return `
    <div class="task-item">
      <h4>${task.user_command}</h4>
      <p class="muted">${task.status}</p>
    </div>`;
}
```

没有 Shadow DOM、没有 Web Components、没有虚拟 DOM。

### 2.3 已有原子组件（shared.css 中定义）

| 类名 | 用途 |
|---|---|
| `.card` | 大型玻璃卡片（24px 圆角，shadow-lg，blur） |
| `.surface` | 实心白色面板（16px 圆角，shadow-sm） |
| `.chip` | 状态徽章，支持 `.ready` `.warning` `.danger` `.muted` |
| `.stack` | 竖向 flex 布局，gap: 12px |
| `.row` | 横向 flex 布局，space-between |
| `.toolbar` | 横向 flex 布局，wrap，gap: 8px |
| `.muted` | 文字色变 `--muted` |
| `.mono` | 字体变等宽 |
| `.eyebrow` | 小号大写标签（accent 色） |
| `.title` | 主标题（22px, display 字体） |
| `.subtitle` | 副标题（13px, muted 色） |
| `.glass-divider` | 渐变分割线 |
| `.selected` | 选中态（accent 边框 + focus ring） |
| `.section-caption` | 区块标题（11px, uppercase, muted） |

### 2.4 按钮变体

```html
<button class="primary">主操作</button>
<button class="secondary">次要操作</button>
<button class="ghost">轻量操作</button>
```

---

## 3. Frameworks & Libraries

### 3.1 运行环境

| 层 | 技术 |
|---|---|
| 桌面壳 | **Electron 35** (Chromium + Node.js 22) |
| 渲染进程 | 原生 HTML / CSS / ESM JavaScript |
| 主进程 | Node.js ESM (`.mjs`) |
| 进程通信 | `contextBridge` + `ipcRenderer` / `ipcMain` |
| 数据库 | `better-sqlite3` (SQLite) |
| HTTP/SSE | Node.js 内置 `http` 模块 |

### 3.2 无 UI 框架

项目**不使用**任何 UI 框架（React/Vue/Angular/Svelte）。从 Figma 转换代码时，输出 **原生 HTML + CSS**，不要输出 JSX 或 Vue 单文件组件。

### 3.3 CSS 方法

- **原生 CSS Variables** 作为 token 系统
- **扁平类名**（`.bubble.user`、`.chip.ready`）而非 BEM 嵌套
- **无 CSS Modules / Styled Components / Tailwind**
- 所有样式写在各 HTML 文件的 `<style>` 块里，共享部分在 `shared.css`

### 3.4 构建系统

**无构建步骤**（无 Webpack / Vite / esbuild）。

文件直接由 Electron 加载，`<script type="module">` 加载 ESM 模块，无需打包。

---

## 4. Asset Management

### 4.1 当前状态

项目**没有独立的 assets 目录**，所有视觉资源内联处理：

| 资源类型 | 处理方式 |
|---|---|
| 图标 | 内联 SVG 字符串 或 Unicode Emoji |
| Orb 动画 | Canvas 2D 程序化绘制（`dock.html`） |
| 背景 | CSS 渐变，无图片 |
| 应用图标 | `assets/icon.ico`（Electron 构建用） |

### 4.2 从 Figma 导出资源的规则

- **矢量图标** → 导出为内联 SVG，不使用 `<img src>` 或外部 URL
- **位图插图** → 如有必要，以 base64 data URI 或 Electron `app.getPath` 本地路径引用
- **渐变/色块** → 转为 CSS `linear-gradient` / `radial-gradient`，不导出为图片

---

## 5. Icon System

### 5.1 两种图标来源

**A. 内联 SVG**（用于重要的操作图标）

```html
<!-- 发送按钮图标 -->
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>

<!-- 通知勾选图标 -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 6L9 17l-5-5"/>
</svg>
```

规格：通常 16×16px 或 18×18px，`stroke="currentColor"`，`fill="none"`，`aria-hidden="true"`。

**B. Unicode Emoji / HTML 实体**（用于功能标签、提供商卡片等低权重图标）

```html
<!-- 快捷栏按钮 -->
<span class="quick-glyph">&#10133;</span>新会话     <!-- ➕ -->
<span class="quick-glyph">&#128218;</span>项目       <!-- 📚 -->
<span class="quick-glyph">&#127760;</span>翻译       <!-- 🌐 -->
<span class="quick-glyph">&#9200;</span>定时         <!-- ⏰ -->

<!-- MCP 服务器卡片图标 -->
<span class="mcp-server-icon">📁</span>   <!-- Filesystem -->
<span class="mcp-server-icon">🧠</span>   <!-- Memory -->
<span class="mcp-server-icon">🔍</span>   <!-- Brave Search -->
<span class="mcp-server-icon">🌐</span>   <!-- Puppeteer -->
```

### 5.2 图标命名规则

SVG 图标无独立文件，不存在图标命名约定。从 Figma 添加新图标时：

1. 将 SVG 内联到对应的 HTML 文件 `<style>` 块下方的 HTML 结构里
2. 用 `currentColor` 继承父元素颜色
3. 固定 `width` / `height` 或通过父容器 CSS 控制尺寸
4. 添加 `aria-label` 或 `aria-hidden="true"`

---

## 6. Styling Approach

### 6.1 CSS 方法论

**扁平原子类 + 局部作用域 `<style>` 块**

- `shared.css` 提供全局 token 和跨文件复用的原子类
- 每个 HTML 文件的 `<style>` 提供该界面专属样式，**不污染其他文件**
- 类名使用 **小写连字符**（kebab-case），无 BEM `__` / `--`

### 6.2 全局样式

`shared.css` 中的全局重置：

```css
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: linear-gradient(135deg, var(--bg-0), var(--bg-1), var(--bg-2)); }
button, input, textarea, select { font: inherit; }
```

所有 `button` 默认有 `120ms` 过渡、hover 时 `translateY(-0.5px)`。

### 6.3 Glass Morphism 固定写法

当从 Figma 看到磨砂玻璃效果时，统一使用：

```css
/* 主要浮层（Overlay 面板级） */
background: rgba(255, 255, 255, 0.78);
backdrop-filter: blur(40px) saturate(180%);
-webkit-backdrop-filter: blur(40px) saturate(180%);
border: 1px solid rgba(255, 255, 255, 0.5);
box-shadow: 0 24px 60px rgba(0, 0, 0, 0.14),
            0 4px 16px rgba(0, 0, 0, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);  /* ← 顶边高光，必须保留 */

/* 轻量弹层（Toast、面板级） */
background: rgba(255, 255, 255, 0.96);
backdrop-filter: blur(24px) saturate(1.2);
-webkit-backdrop-filter: blur(24px) saturate(1.2);
border: 1px solid rgba(255, 255, 255, 0.7);
box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
```

### 6.4 响应式

Console 在 `≤ 900px` 下切换为单列：

```css
@media (max-width: 900px) {
  .tasks-layout,
  .history-layout,
  .advanced-grid { grid-template-columns: 1fr; }
}
```

Overlay 宽度固定 520px，不响应窗口大小（Electron 透明窗口的特性）。

---

## 7. Project Structure

```
e:/linxi/
├── index.cjs                    ← Electron 入口（CommonJS wrapper）
├── package.json
├── shared.css → src/desktop/renderer/shared.css
│
├── src/
│   ├── desktop/
│   │   ├── tray/
│   │   │   └── electron-main.mjs     ← 主进程：窗口管理、托盘、快捷键
│   │   └── renderer/
│   │       ├── shared.css            ← ★ Design Token 唯一来源
│   │       ├── overlay.html/.js      ← 悬浮对话框 UI
│   │       ├── dock.html/.js         ← 浮窗圆形图标
│   │       ├── console.html/.js      ← 控制台（设置/历史/任务）
│   │       ├── notification.html/.js ← Toast 通知
│   │       └── preload.cjs           ← IPC Bridge
│   │
│   └── service/                      ← 后端服务（与 UI 无关）
│       ├── core/                     ← HTTP/SSE 服务器、任务运行时
│       ├── action_tools/             ← AI 工具实现
│       ├── ai/                       ← 提供商/MCP/Skills 注册表
│       └── executors/                ← 任务执行器
│
├── scripts/verify-*.mjs             ← 32 个子系统验证脚本
├── UI_DESIGN_SPEC.md                ← 完整 UI 设计规范（人类阅读）
└── FIGMA_DESIGN_SYSTEM.md          ← 本文件（Figma MCP 对接规范）
```

---

## 8. Figma → Code 转换规则（给 MCP 使用）

### 8.1 输出格式

从 Figma 设计稿生成代码时：

- 输出 **原生 HTML + CSS**
- CSS 写在对应文件的 `<style>` 块内，或追加到 `shared.css`（若为新原子类）
- 不输出 React JSX / Vue SFC / TypeScript
- 不引入新的 npm 包

### 8.2 颜色处理

```
Figma 色板 → 检查是否已有对应 CSS 变量 → 使用变量
              └─ 没有对应变量 → 添加到 shared.css :root 并使用
```

### 8.3 字体处理

```
Figma 文字样式 → 映射到已有字号/字重/行高组合
不要生成新的 font-size，使用最接近的现有值（11/12/13/14/16/22px）
```

### 8.4 圆角处理

```
Figma 圆角 → 映射到 CSS 变量
  4px  → 不单独设置（内部元素）
  8px  → var(--radius-sm)
  12px → var(--radius-md)
  16px → var(--radius-lg)
  24px → var(--radius-xl)
  全圆  → var(--radius-pill) 或 border-radius: 50%
```

### 8.5 阴影处理

```
Figma 投影 → 映射到 CSS 变量
  轻投影（2–4px）   → var(--shadow-sm)
  中投影（8–12px）  → var(--shadow-md)
  大投影（16–24px） → var(--shadow-lg)
  超大投影（>24px） → var(--shadow-xl)
```

### 8.6 间距处理

使用 4px 基础网格：`4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24px`

### 8.7 组件插入位置

| 新组件类型 | 插入到 |
|---|---|
| Overlay 内的新气泡/面板 | `overlay.html` 的 `<style>` + HTML，逻辑在 `overlay.js` |
| Console 新 Tab 或设置项 | `console.html` + `console.js` |
| 全局可复用原子类 | `shared.css` |
| 系统级通知变体 | `notification.html` |

---

## 9. Key Patterns to Follow

### 9.1 玻璃面板模板

```html
<div class="my-panel">
  <!-- 内容 -->
</div>

<style>
.my-panel {
  border-radius: var(--radius-xl);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
  padding: 14px 18px;
}
</style>
```

### 9.2 Primary 按钮模板

```html
<button class="primary">操作名称</button>
```

（shared.css 已定义，无需额外 CSS）

### 9.3 状态 Chip 模板

```html
<span class="chip ready">就绪</span>
<span class="chip warning">待处理</span>
<span class="chip danger">失败</span>
<span class="chip muted">已禁用</span>
```

### 9.4 设置分组模板

```html
<div class="settings-group">
  <h3 class="settings-group-title">分组标题</h3>
  <p class="muted" style="font-size:12px;margin:0 0 12px;">说明文字</p>
  <!-- 内容 -->
</div>
```

### 9.5 Toast 入场动画模板

```css
.my-toast {
  transform: translateY(20px);
  opacity: 0;
  transition: transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1),
              opacity 200ms ease;
}
.my-toast.visible {
  transform: translateY(0);
  opacity: 1;
}
```
