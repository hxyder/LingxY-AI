# HTTPS Runtime

Office Add-in integration needs a dedicated HTTPS-facing surface.

Current scope:

- transport strategy manifest for `https://localhost:9413`
- self-signed certificate installation notes
- fallback path declaration for protocol-handler handoff

This directory intentionally contains scaffold code only and does not yet run a real TLS server.
