# Local Runtime

`UCA-015` introduces a persistent local runtime with:

- SQLite database at `%APPDATA%/UCA/data/uca.db` by default
- runtime config at `%APPDATA%/UCA/config/runtime.json`
- HTTP API and SSE on `127.0.0.1` with configurable port
- Electron main entry at `src/desktop/tray/electron-main.mjs`

Start the runtime with:

```bash
npm run start:runtime
```

Override the port with `UCA_PORT`.

For day-to-day desktop trial use, prefer:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-trial.ps1
```

That command starts the local runtime and the Electron desktop shell together.
