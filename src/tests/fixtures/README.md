# Synthetic PDF fixtures

These PDFs are generated in this repository and contain no personal, licensed, or external document content. They have real page trees, font resources, content streams, xref tables, and readable numbered pages so Playwright exercises PDF.js parsing and rendering rather than mocked canvases.

- `leafspace-12-pages.pdf`: 12 portrait pages, distinctive page numbers and green bars
- `leafspace-other-book.pdf`: a separate four-page document with a distinct fingerprint

Regenerate deterministically with `node src/tests/fixtures/generate-pdf.mjs`.

The E2E suite uses a fresh browser context (including isolated IndexedDB) per test. It imports fixtures through the real file input, drives public UI controls, and reads IndexedDB only to wait for durable saves. It never injects application-store state.
