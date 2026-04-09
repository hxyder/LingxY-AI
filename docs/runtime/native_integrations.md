# Native Integrations

`UCA-016` wires three user-level native entry paths:

- Explorer context menu via `scripts/install-explorer-entry.ps1`
- Chrome / Edge Native Messaging host via `scripts/install-native-host.ps1`
- Office Task Pane selection capture via `office_addin/shared/office_bridge.js`

Current registry locations:

- Explorer menu: `HKCU\Software\Classes\*\shell\UCA.Analyze`
- Chrome Native Host: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.uca.host`
- Edge Native Host: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host`

Current limitations:

- Explorer helper is published locally with `dotnet publish`
- Browser extension requires updating `allowed_origins` to the real extension IDs after unpacked install
- Office defaults to protocol fallback unless a direct runtime HTTP path is explicitly enabled
