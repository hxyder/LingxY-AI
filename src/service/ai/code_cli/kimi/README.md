# Kimi Code CLI Adapter

This directory now contains the runtime-side Kimi CLI adapter logic used by LingxY.

Current responsibilities:

- runtime discovery from injected config, runtime config file, env vars, or `PATH`
- credential / config presence checks
- version probing via `kimi --version`
- normalized runtime config for the Kimi executor

Execution still lives in `src/service/executors/kimi/`, while adapter-specific resolution and health checks live here.
