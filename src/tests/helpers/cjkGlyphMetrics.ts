/** Test-only shape oracle for the independently generated CJK fixture. */
export const CJK_GLYPHS = Array.from('中文汉字页境测试简体繁體縮圖预览');
export const CJK_LIMITS = { mean: 0.28, worst: 0.40 } as const;
// Engineering ambiguity allowance for nearly tied, very small glyph templates.
// It is not a grayscale quantization bound; see the recorded cross-engine calibration.
export const CJK_IDENTITY_EPSILON = 0.01;
export interface GrayPage { pixels: Uint8Array; width: number; height: number }
export interface GlyphCell { left: number; right: number; top: number; bottom: number }

export function cjkCells(width: number): GlyphCell[] {
  return CJK_GLYPHS.map((_, index) => {
    const column = index % 8, row = Math.floor(index / 8);
    return {
      left: Math.floor((50 + column * 32) * width / 600),
      right: Math.floor((50 + (column + 1) * 32) * width / 600),
      top: Math.floor((42.5 + row * 70) * width / 600),
      bottom: Math.ceil((95 + row * 70) * width / 600),
    };
  });
}

/** Fractional pixel sampling models rasterizer placement, not a blur allowance. */
export function sampleGray(page: GrayPage, x: number, y: number): number {
  const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top;
  const pixel = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < page.width && yy < page.height
    ? page.pixels[yy * page.width + xx] : 255;
  return (pixel(left, top) * (1 - fx) + pixel(left + 1, top) * fx) * (1 - fy)
    + (pixel(left, top + 1) * (1 - fx) + pixel(left + 1, top + 1) * fx) * fy;
}

export function glyphDistance(actual: GrayPage, oracle: GrayPage, index: number, candidate = index): number {
  if (actual.width !== oracle.width || actual.height !== oracle.height) throw new Error('Glyph oracle dimensions must match');
  const cells = cjkCells(actual.width), cell = cells[index], reference = cells[candidate];
  let best = 1;
  // FontFace hinting quantizes independently at small sizes. Permit no more than
  // one comparison-image pixel per axis. Shift either image, never both: shifting an already
  // antialiased image back can otherwise double-filter a genuine half-pixel move.
  for (const shiftActual of [false, true]) for (let dy = -1; dy <= 1; dy += 0.5) for (let dx = -1; dx <= 1; dx += 0.5) {
    let difference = 0, ink = 0;
    for (let y = cell.top; y < cell.bottom; y++) for (let x = cell.left; x < cell.right; x++) {
      // All candidates get the same cell mapping and registration freedom.
      const rx = Math.min(reference.right - 1, reference.left + Math.floor((x - cell.left) * (reference.right - reference.left) / (cell.right - cell.left)));
      const ry = Math.min(reference.bottom - 1, reference.top + Math.floor((y - cell.top) * (reference.bottom - reference.top) / (cell.bottom - cell.top)));
      const observed = 255 - sampleGray(actual, x + (shiftActual ? dx : 0), y + (shiftActual ? dy : 0));
      const expected = 255 - sampleGray(oracle, rx + (shiftActual ? 0 : dx), ry + (shiftActual ? 0 : dy));
      difference += Math.abs(observed - expected);
      ink += observed + expected;
    }
    best = Math.min(best, ink ? difference / ink : 1);
  }
  return best;
}

export function compareCjkGlyphs(actual: GrayPage, oracle: GrayPage) {
  const glyphs = CJK_GLYPHS.map((glyph, index) => {
    const error = glyphDistance(actual, oracle, index);
    const alternatives = CJK_GLYPHS.map((other, candidate) => ({ glyph: other, error: candidate === index ? Infinity : glyphDistance(actual, oracle, index, candidate) }));
    const nearestOther = alternatives.reduce((best, item) => item.error < best.error ? item : best);
    return { glyph, row: Math.floor(index / 8), error, nearestOther, identityMargin: nearestOther.error - error };
  });
  return { width: actual.width, height: actual.height, glyphs,
    mean: glyphs.reduce((sum, item) => sum + item.error, 0) / glyphs.length,
    worst: Math.max(...glyphs.map(item => item.error)) };
}
