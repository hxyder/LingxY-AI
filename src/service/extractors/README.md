# Extractors

File extraction adapters normalize local files into `ContextPacket`-ready metadata.

Current built-ins:

- `text/plain`
- `text/markdown`
- `application/pdf` detection with text-layer vs OCR branching
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` detection with placeholder extraction
- `image/png` and `image/jpeg` with OCR placeholder extraction

The current Phase 5 scaffold keeps the pipeline stable until dedicated runtime dependencies are introduced.
