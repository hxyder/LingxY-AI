# Kimi Executor

This executor wraps a Code CLI style subprocess that speaks JSON Lines over stdout.

Current guarantees:

- stable task package builder
- JSONL event parser
- timeout handling
- artifact path capture
- mockable subprocess integration for tests

The executor is intentionally generic so future Code CLI providers can reuse the same transport shape.
