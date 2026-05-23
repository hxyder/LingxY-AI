# Native Integrations

LingxY wires three user-level native entry paths:

- Explorer context menu via `scripts/install-explorer-entry.ps1`
- Chrome / Edge Native Messaging host via `scripts/install-native-host.ps1`
- Office Task Pane selection capture via `office_addin/shared/office_bridge.js`

Some registry keys and protocol ids still use the legacy `UCA` / `com.uca.*`
namespace. Treat those as compatibility ids, not public product naming, until a
data and registry migration is designed and verified.

Current registry locations:

- Explorer menu: `HKCU\Software\Classes\*\shell\UCA.Analyze`
- Chrome Native Host: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.uca.host`
- Edge Native Host: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host`

Current limitations:

- Explorer helper is published locally with `dotnet publish`
- Browser extension setup uses the stable unpacked extension ID
  `oegpgmnonnejpkgpjmpnbnjlpfmkojkf`, so users no longer need to copy IDs.
  Chrome and Edge still require the user to load or approve the unpacked
  extension from the browser extensions page.
- Office defaults to protocol fallback unless a direct runtime HTTP path is explicitly enabled
