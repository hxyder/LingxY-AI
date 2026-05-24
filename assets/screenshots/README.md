# Screenshot Assets

Suggested public README screenshots:

- `console-workbench.png`: Console with Chat, task timeline, files/context rail, and provider status visible.
- `browser-sidepanel-actions.png`: Browser side panel with page/video action selector.
- `overlay-capture.png`: Overlay above another app with captured context.
- `approval-card.png`: Side-effect approval card.
- `voice-note.png`: Voice/note capture or transcription status.

Never commit raw screenshots. Mask or replace:

- API keys, provider secret status, auth tokens, OAuth account names, email addresses, phone numbers, and calendar titles.
- Absolute local paths such as `C:\Users\...`, task IDs, conversation IDs, account IDs, and database paths.
- Real prompts, private documents, browser tabs, filenames, generated artifact contents, and notification text.
- Provider command paths that include a username or private install location.

Use the local redaction helper before adding public images:

```powershell
npm run media:redact-screenshot -- raw-console.png assets/screenshots/console-workbench.png --box=32,80,420,44 --box=900,20,260,60
```

Prefer demo fixtures and fake accounts over real work data. If a screenshot is
not obviously safe, do not commit it.
