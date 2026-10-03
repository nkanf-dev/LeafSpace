# Synthetic PDF fixtures

These PDFs are generated in this repository and contain no personal, licensed, or external document content. They have real page trees, font resources, content streams, xref tables, and readable numbered pages so Playwright exercises PDF.js parsing and rendering rather than mocked canvases.

- `leafspace-12-pages.pdf`: 12 portrait pages, distinctive page numbers and green bars
- `leafspace-other-book.pdf`: a separate four-page document with a distinct fingerprint
- `leafspace-120-pages.pdf`: long numbered book with a nested three-entry PDF outline
- `leafspace-password-required.pdf`: synthetic opening-password rejection control
- `leafspace-owner-only.pdf`: owner-permission encryption with an empty opening password, which must remain readable
- `scanned-document.test.ts` creates a genuine 106 MB raster-only PDF in a temporary test directory, then removes it; large binaries are not committed

Regenerate the numbered unencrypted fixtures deterministically with `node src/tests/fixtures/generate-pdf.mjs`.

Regenerate the two small encryption controls with `python src/tests/fixtures/generate-protected-pdfs.py` using optional development-only pypdf 6.10.0. CI reads the committed fixtures and does not need Python packages. The script uses only synthetic test strings; it does not contain user credentials. Encryption file identifiers may vary on regeneration.

The E2E suite uses a fresh browser context (including isolated IndexedDB) per test. It imports fixtures through the real file input, drives public UI controls, and reads IndexedDB to wait for durable saves. Recovery tests seed faults only in their isolated synthetic-book IndexedDB records. The suite never injects application-store state.
