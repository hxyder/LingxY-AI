# Office Localhost Certificate Setup

This repository does not yet install a real certificate. The current scaffold records the planned paths and the fallback decision.

Future direct HTTPS validation should cover:

1. Generate a localhost development certificate for port `9413`.
2. Install the root certificate into the trusted root store.
3. Verify Office Add-in webviews accept `https://localhost:9413`.
4. Uninstall and roll back the trusted root cleanly.

Enterprise warning:

- Group Policy may block trust-root installation.
- Some environments still reject localhost TLS inside Office even after trust import.
- Because of that, Phase 4 base currently treats protocol fallback as the selected ship path.
