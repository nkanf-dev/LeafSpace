# Synthetic CJK font regression controls

All page text and layout here were independently authored for tests. None comes
from a user's PDF, filename, screenshots, or reading history. Each page is
600 × 360 pt. The three PDFs are small and safe for repository and CI artifacts.

- `embedded-cjk-identity-h.pdf`: a Type 0 / CIDFontType2 font, embedded TrueType
  outlines, Identity-H encoding, identity CID-to-GID mapping, and ToUnicode map.
  The first two rows are `中文汉字页境测试` and `简体繁體縮圖预览`; a third row mixes
  CJK and Latin. The embedded font has only these synthetic fixture characters.
- `fixture-cjk.ttf`: 6.3 KiB test-only outline subset, derived from the Simplified
  Chinese face (index 2) of Noto Sans CJK Regular. CFF curves were converted to
  quadratic TrueType outlines with FontTools. The modified font was renamed to
  LeafSpaceFixtureCJK. It remains under SIL OFL 1.1. Its source distribution's
  copyright/license notice is preserved in `CJK-FONT-LICENSE.txt` (that notice
  also describes Debian packaging, which is not part of the font subset).
- `nonembedded-cjk-unigb.pdf`: STSong-Light, UniGB-UCS2-H, and no embedded font.
  Its test checks local CMap routing and explicit worker-to-DOM recovery only.
  A readable CJK result still requires an available system font; CI does not
  pin one, so this control makes no cross-platform glyph-quality assertion.
- `nonembedded-standard-font.pdf`: Helvetica and Times-Roman control available
  for manual standard-font diagnosis; no user content or external resources.
- `embedded-cjk-poppler-1000.png`: the independent 1000 × 600 Poppler pixel oracle
  used by browser tests. `embedded-cjk-poppler-240.png` preserves the 240 × 144
  independently rendered calibration image. Neither is a browser/PDF.js capture.

## Pixel assertion

`pdf-fonts.test.ts` reads the actual reader canvas or decoded thumbnail image.
It compares 16 separate CJK cells with the independent Poppler oracle, at the
thumbnail's intrinsic width (170 px), or downsampled to 240 px for the reader.
Both images are flattened onto white and identically resized using Sharp.
For each pixel, ink is `255 - grayscale`; each cell's error is
`sum(abs(actualInk - referenceInk)) / sum(actualInk + referenceInk)`.

The test-only helper permits bounded rasterizer registration: ±1 comparison-image pixel
per axis (native at 170 px for thumbnails; downsampled to 240 px for readers), evaluated at 0.5 px steps with bilinear sampling. It shifts either the
observed image or the reference, never both, and takes the lower error. This
symmetric comparison handles a true half-pixel displacement without
interpolating an already antialiased image twice. No blur, rotation, scale search,
or unbounded alignment is permitted. All 16 glyphs still must score below 0.40,
and their mean below 0.28. These original shape limits are unchanged.

A separate identity safeguard compares every cell to all 15 other distinct
reference glyphs with exactly the same bounded alignment and cell-size mapping.
The expected glyph must be no more than 0.01 worse than its closest alternative.
That is an engineering ambiguity margin for near-tied tiny glyphs, not a derived
8-bit quantization bound. One WebKit DOM cell (體) has a 0.00178 near-tie with 测;
all 240 deliberately wrong single-cell substitutions have a gap of at least
0.17126, over 17 times the allowance. This supplementary check rejects a wrong
glyph even if its ink density passes the shape limits.

### Recorded cross-engine calibration

The initial, unregistered metric incorrectly rejected readable Chromium DOM
thumbnail strokes (mean 0.32176, worst 0.53160). Visual inspection and registration
show subpixel placement/hinting differences, not the observed tofu failure.
The corrected helper was replayed against all 18 first-attempt positive pixel
attachments from the six-project CI run. Mean / worst cell errors were:

| Project | Reader | Worker thumbnail | DOM thumbnail |
| --- | --- | --- | --- |
| Chromium | 0.10272 / 0.20423 | 0.11450 / 0.16668 | 0.16790 / 0.23429 |
| Tablet | 0.10272 / 0.20423 | 0.11450 / 0.16668 | 0.16790 / 0.23429 |
| Mobile Chromium | 0.12669 / 0.18679 | 0.11450 / 0.16668 | 0.16790 / 0.23429 |
| Firefox | 0.09156 / 0.15853 | 0.11443 / 0.16095 | 0.15550 / 0.21509 |
| WebKit | 0.05174 / 0.10111 | 0.15241 / 0.17866 | 0.21743 / 0.25679 |
| Mobile WebKit | 0.05173 / 0.09521 | 0.15241 / 0.17866 | 0.21743 / 0.25679 |

All recorded positives meet the unchanged shape limits and the identity check.
Artifact replay validates the helper on those captured bytes; it is not a new
browser run. The raw image attachments and per-glyph error JSON remain the E2E
diagnostics.

### Negative controls

Focused unit tests use the committed independent Poppler oracle and the exact
same helper. They accept bounded ±0.5 px placement and +1 px placement, and reject
blank pixels, synthetic tofu outlines, one real glyph repeated across the page,
all 240 single-cell substitutions with another fixture glyph, and 2/3 px diagonal
displacement beyond the registration bound. Read-only calibration of the original
safe synthetic unregistered-FontFace failure still gives 0.54823 mean / 0.59473
worst; white gives 1 / 1; repeated 中 gives 0.32066 / 0.42733; 2 px displacement
0.40453 / 0.52491; and 3 px displacement 0.49127 / 0.65188. A +0.5 px diagonal
positive control is approximately 0.004 / 0.005, with all identities correct.
This is stroke-shape testing with explicit negative controls, not a nonwhite
pixel assertion or a page-whitespace-dominated comparison.

The custom-worker case requires a matching successful 170 × 102 worker message,
no worker errors, and zero DOM WebP encodes. Forced fallback requires blocked
custom-worker construction and an observed DOM encode. A working main-thread
fallback therefore cannot conceal a broken custom worker.

## Regeneration (optional development tools only)

CI reads committed inputs and goldens; it needs neither Python nor Poppler.
The original tool versions were FontTools 4.61.1, pypdf 6.10.0, ReportLab 4.4.9,
and Poppler 26.05.0. The Noto source came from the installed fonts-noto-cjk package.
Regenerate into a temporary directory first; compare outlines and review images
before replacing committed reference files. PDF metadata, timestamps and font
checksum bytes may vary without changing the rendered glyphs.

```sh
python src/tests/fixtures/generate-cjk-fixtures.py \
  --font /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc \
  --font-number 2 \
  --font-license /usr/share/doc/fonts-noto-cjk/copyright \
  --output /tmp/leafspace-cjk-fixtures
pdftoppm -png -singlefile -scale-to-x 1000 -scale-to-y 600 \
  /tmp/leafspace-cjk-fixtures/embedded-cjk-identity-h.pdf \
  /tmp/leafspace-cjk-fixtures/embedded-cjk-poppler-1000
pdftoppm -png -singlefile -scale-to-x 240 -scale-to-y 144 \
  /tmp/leafspace-cjk-fixtures/embedded-cjk-identity-h.pdf \
  /tmp/leafspace-cjk-fixtures/embedded-cjk-poppler-240
```

Do not regenerate goldens with PDF.js, or replace these fixtures with documents
supplied by users. Keep the font license with the subset and embedded PDF.
