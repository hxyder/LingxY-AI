# Browser Overlay Show Rules

- 默认模式：`smart`
- 防抖：`150ms`
- 稳定判定：`200ms`
- 最小选区长度：`5`
- 长选区模式阈值：`32`
- 自动隐藏：`5000ms`
- 预览展开：`300ms`
- 黑名单域名：
  - `mail.google.com`
  - `outlook.live.com`

不显示条件：

- Presenter Mode 开启
- 当前焦点位于输入框 / `textarea` / `contenteditable`
- 域名命中黑名单
- 选区长度不足
- 本轮选区被 `Esc` 隐藏
- 选区已滚出当前视口
