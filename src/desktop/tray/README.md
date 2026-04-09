# Tray

Electron main-process tray host and window lifecycle live here.

Current foundation:

- loads real renderer pages instead of data-url placeholders
- owns tray menu, shortcut registration, and shell window show/hide IPC
