# Extractors

File extraction adapters normalize local files into `ContextPacket`-ready metadata.

Current built-ins:

- `text/plain`
- `text/markdown`
- `application/pdf` detection with text-layer vs OCR branching
- Office Open XML text extraction for DOCX / XLSX / PPTX
- `image/png` and `image/jpeg` OCR through Windows OCR or Tesseract when available

Scanned PDFs without a text layer use `pdftoppm` when available, then run the generated page images through the image OCR pipeline. If `pdftoppm` or OCR is unavailable, the extractor reports `pdf_ocr_unavailable` instead of returning synthetic OCR text.
