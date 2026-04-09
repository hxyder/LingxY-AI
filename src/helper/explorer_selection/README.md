# Explorer Selection Helper

This folder now contains the payload contract plus a real .NET helper for `Ctrl+Shift+E`.

`UcaExplorerSelectionHelper/` connects to the local runtime over the named pipe `\\.\pipe\uca-helper-explorer-selection` and forwards selected file paths plus the user command.
