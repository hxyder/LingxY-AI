# Known Repo Verification Failures

当前没有已知的、需要在 `npm run check` 中忽略的验证失败。

历史记录：

- Office add-in 品牌断言已经收口到 `LingxY for Word / Excel / PowerPoint`。
- Trial release readiness 现在会先构建 trial bundle，再检查 `Check LingxY Desktop Trial.cmd`、`Setup LingxY Desktop Trial.cmd`、`Launch LingxY Desktop Trial.cmd`、`Stop LingxY Desktop Trial.cmd`。
- PDF/OCR 截图默认命令路由问题已修复并由 verifier 覆盖。

维护纪律：

- 新增已知失败前，必须先确认它不是当前改动造成的回归。
- 如果失败来自真实框架问题，优先修框架和行为测试，不把失败登记成长期豁免。
- 这个文件只记录短期、已定位、可复现的例外；不能成为绕过 `npm run check` 的清单。
