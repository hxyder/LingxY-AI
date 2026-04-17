# Office Add-in Sideload

Current scaffold ships three manifest files:

- `office_addin/word/manifest.xml`
- `office_addin/excel/manifest.xml`
- `office_addin/ppt/manifest.xml`

Recommended one-click setup:

1. Start UCA Desktop Trial.
2. Open `Settings` in the desktop console.
3. In `One-click Setup`, click `Configure` under `Office Add-ins`.
4. If Windows asks for administrator approval, approve it so the local SMB share can be created.
5. Restart Word / Excel / PowerPoint.
6. In the Office app, open `Home` / `Insert` → `Add-ins` → `Shared Folder`, then add the matching UCA add-in.
7. After sideloading, UCA also appears on the `Home` ribbon as an `Open UCA` button. If the ribbon button does not appear, remove the sideloaded add-in, clear the Office web add-in cache, restart the Office host, and add it again from `Shared Folder`.

The one-click setup performs the same steps Microsoft documents for a Windows network share catalog:

- Copies all three manifests into `office_addin/catalog/`.
- Creates or verifies the `\\<COMPUTERNAME>\UCAOfficeAddins` local share.
- Registers `\\<COMPUTERNAME>\UCAOfficeAddins` under the current user's Office `TrustedCatalogs` registry key with `Show in Menu` enabled.
- Queues an Office web add-in refresh by setting `HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\ClearInstalledExtensions` to `1`.
- When run from the desktop console, clears the local Office WEF cache after Word, Excel, and PowerPoint are closed.

Manual fallback:

1. Run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-office-addins.ps1`.
2. Restart the target Office host on Windows.
3. Choose `SHARED FOLDER` in the Office Add-ins dialog.
4. If the shared folder is empty, choose `Advanced` → `Refresh` in the Office Add-ins dialog, then close and reopen the Office host.
5. Verify the Task Pane loads `http://127.0.0.1:4310/office/task_pane.html`.
6. Confirm selection capture can build an `office_selection` payload.

Deep reset fallback:

1. Close Word, Excel, and PowerPoint.
2. Run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-office-addins.ps1 -ResetCache`.
3. Reopen the Office host and choose `Advanced` → `Refresh` in the Office Add-ins dialog.

Task pane capabilities:

- `Current selection` reads selected Word text, Excel cells, or PowerPoint text/shapes.
- `Whole document / sheet / presentation` reads the Word body, Excel active worksheet used range, or PowerPoint text via best-effort Office file text capture.
- `Analyze Whole` submits the larger Office context to UCA.
- `Replace Selection` writes the reviewed result back over the current selection.
- `Insert Result` inserts the reviewed result at the current cursor/selection with a UCA label.
- PowerPoint whole-presentation extraction is best-effort; select specific slide text when precision matters.

Ribbon placement:

- The manifests include Office command `VersionOverrides` with `PrimaryCommandSurface`.
- The command is placed on the built-in `Home` tab (`TabHome`) in a `UCA` group.
- The `Open UCA` button uses `ShowTaskpane` and opens the same task pane URL as the shared-folder add-in.
- This ribbon placement is a sideload manifest feature; Office may require re-adding the add-in after a manifest change.

Phase 4 base ship assumes manual sideload rather than AppSource distribution.
