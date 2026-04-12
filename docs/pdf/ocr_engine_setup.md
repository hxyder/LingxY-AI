# OCR Engine Setup

Selected local OCR status:

- image OCR: Windows OCR first, then Tesseract if installed
- scanned PDF OCR: `pdftoppm` when installed, then Windows OCR / Tesseract for rendered page images
- fallback: scanned PDFs return `pdf_ocr_unavailable` when no raster OCR path is available
- install mode: PDF raster OCR tools remain outside the main application package

Planned PDF OCR health checks:

1. runtime present
2. model assets present
3. OCR worker responds to a synthetic image request
4. crash recovery restarts the OCR worker

Current repository does not return synthetic OCR text for scanned PDFs.
