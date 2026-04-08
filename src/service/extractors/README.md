# Extractors

File extraction adapters normalize local files into `ContextPacket`-ready metadata.

Current built-ins:

- `text/plain`
- `text/markdown`
- `application/pdf` detection with placeholder extraction
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` detection with placeholder extraction

The placeholder binary extractors keep the pipeline stable until dedicated PDF/DOCX libraries are introduced.
