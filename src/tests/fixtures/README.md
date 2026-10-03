# Synthetic PDF fixtures

These PDFs are generated in this repository and contain no personal, licensed, or external document content. They have real page trees, content streams, xref tables, and numbered or raster-image pages so Playwright exercises PDF.js parsing and rendering rather than mocked canvases.

- `leafspace-12-pages.pdf`: 12 portrait pages, distinctive page numbers and green bars
- `leafspace-other-book.pdf`: a separate four-page document with a distinct fingerprint
- `leafspace-120-pages.pdf`: long numbered book with a nested three-entry PDF outline
- `leafspace-password-required.pdf`: synthetic opening-password rejection control
- `jpx-scan.pdf` and `rgb-control.pdf`: the same original red/green scan, encoded as real lossless JPEG2000/JPX and Flate-compressed RGB respectively; three decoded-pixel samples distinguish correct rendering from blank success
- `leafspace-mixed-raster.pdf`: ten small image-only pages covering portrait, landscape, square, 90/180/270-degree rotation, offset CropBox, rotated CropBox and 6:1 tall/wide geometry; colored quadrants make orientation and decoded pixels observable
- `leafspace-owner-only.pdf`: owner-permission encryption with an empty opening password, which must remain readable
- `scanned-document.test.ts` creates a genuine 106 MB raster-only PDF in a temporary test directory, then removes it; large binaries are not committed

Regenerate the numbered unencrypted fixtures deterministically with `node src/tests/fixtures/generate-pdf.mjs`.

Regenerate the mixed raster fixture deterministically with `node src/tests/fixtures/generate-mixed-raster.mjs`. Its committed SHA-256 is `d52599fba6e4d47d905d6067d69dad812951a5eff18da00cd12b6a7e1f7be8e7`. This fixture is 5.7 KiB and exercises geometry, not document-size performance. Poppler inspection should use `pdftoppm -cropbox` to match the PDF page viewport.

Regenerate the two small encryption controls with `python src/tests/fixtures/generate-protected-pdfs.py` using optional development-only pypdf 6.10.0. CI reads the committed fixtures and does not need Python packages. The script uses only synthetic test strings; it does not contain user credentials. Encryption file identifiers may vary on regeneration.

The E2E suite uses a fresh browser context (including isolated IndexedDB) per test. It imports fixtures through the real file input, drives public UI controls, and reads IndexedDB to wait for durable saves. Recovery tests seed faults only in their isolated synthetic-book IndexedDB records. The suite never injects application-store state.

Regenerate the small decoder controls with `node src/tests/fixtures/generate-jpx-fixtures.mjs`. The script uses only Node built-ins and an embedded, SHA-256-verified JP2 stream. Its original encoder was Python 3.12.14, Pillow 12.3.0 and OpenJPEG 2.5.4 with lossless `irreversible=False`; `reencode-jpx.py` is an optional source re-encoder, not an application or CI dependency. `jpx-fixture-manifest.json` records source and PDF hashes. The RGB compression bytes may vary with zlib versions; both images retain identical decoded pixels.

Decoder samples use intrinsic bitmap dimensions: center x at y=1/4 is RGBA `[210,40,40,255]`, y=3/4 is `[20,130,40,255]`, and y=1/2 is the white gap. Reader channels tolerate 2 levels and lossy thumbnail channels 24, with alpha exactly 255. The thumbnail tolerance follows measured WebP variation at small widths and is far below the 235-level error of missing-decoder white output.
