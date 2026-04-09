# Cross-Site Test Matrix

建议手动覆盖至少以下站点与场景：

- `github.com`：代码块、issue 正文、评论区
- `wikipedia.org`：长段落与多列布局
- `docs.microsoft.com`：滚动后再选区
- `arxiv.org`：论文摘要和窄栏布局
- `news.ycombinator.com`：极简文本布局
- `medium.com`：大字号段落
- `mail.google.com`：应命中黑名单不显示
- `outlook.live.com`：应命中黑名单不显示
- 任意富文本编辑器页面：输入框内选区不显示

重点观察：

- 右侧超界时是否翻转到左侧
- 页面缩放后是否仍定位正确
- 滚动中是否平滑跟随
- `Esc` 后本轮选区是否保持静默
