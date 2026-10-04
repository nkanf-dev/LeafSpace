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

This measures glyph stroke shape, not nonwhite pixels or whole-page similarity.
White output scores 1, regardless of surrounding whitespace. All 16 glyphs must
score below 0.40 and their mean below 0.28. Independent synthetic Node raster
calibration at 240 px gave path-render errors averaging 0.067 (worst 0.128),
versus broken unregistered FontFace output averaging 0.768 (worst 0.857), against
the direct 240 px Poppler render. Resizing the safe path/registered probes to
170 px and encoding WebP at quality 80 against the downsampled 1000 px oracle
produced means 0.064–0.079 and worst cells 0.090–0.104. The broken route remained
above 0.65 mean. Thresholds allow antialiasing and lossy WebP differences while
rejecting the observed tofu failure by a wide margin. Browser execution remains
necessary to validate platform-specific behavior; Node calibration is not an
E2E pass.

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
