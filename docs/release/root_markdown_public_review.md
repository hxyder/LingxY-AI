# Root Markdown Public Review

This file is the release-facing decision log for tracked Markdown files that
live at the repository root and are not standard community files such as
`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, or `THIRD_PARTY_LICENSES.md`.

Each entry must be reviewed before a public GitHub push. The verifier requires
every non-standard root Markdown file to appear here with one of these decisions:

- `public-ok`: safe to publish as-is.
- `temporary-root`: needed for current development, but should be moved or
  rewritten before a public announcement.
- `move-internal`: must not be intentionally published; move into a local
  ignored folder or delete before making the repository public.
- `release-notes-only`: keep only if converted into release notes or public docs.

| File | Decision | Owner | Notes |
| --- | --- | --- | --- |
| `collaborative_ai_workspace_design.md` | `temporary-root` | hxy94045@gmail.com | Active design context; keep during framework cleanup, then decide whether to convert into public architecture docs. |
| `产品介绍.md` | `public-ok` | hxy94045@gmail.com | Public-facing product description; review wording before launch, but it is intended for users. |
| `日常用户功能补充方案.md` | `temporary-root` | hxy94045@gmail.com | Product planning discussion; useful during v1.0 shaping, likely move into internal notes before public announcement. |
| `程序整理.md` | `temporary-root` | hxy94045@gmail.com | Active Codex/Claude audit log; keep while cleanup is ongoing, then move internal or summarize into release docs. |

