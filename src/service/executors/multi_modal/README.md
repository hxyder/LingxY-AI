# Multi-modal Executor

This executor owns image and OCR-assisted reasoning paths.

Current scaffold:

- accepts `image` context packets
- consumes OCR text when present
- produces a placeholder descriptive result

Future extensions:

- cloud vision model adapters
- image compression and caching
- cost ceilings and budget enforcement
