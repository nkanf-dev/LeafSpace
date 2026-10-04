// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CJK_GLYPHS, CJK_IDENTITY_EPSILON, CJK_LIMITS, cjkCells, compareCjkGlyphs, glyphDistance, sampleGray, type GrayPage } from '../helpers/cjkGlyphMetrics';

let oracle: GrayPage;
beforeAll(async () => {
  const path = fileURLToPath(new URL('../fixtures/embedded-cjk-poppler-1000.png', import.meta.url));
  oracle = { width: 170, height: 102, pixels: await sharp(path).resize(170, 102).greyscale().raw().toBuffer() };
});
const copy = (): GrayPage => ({ ...oracle, pixels: Uint8Array.from(oracle.pixels) });
const accepts = (page: GrayPage) => {
  const result = compareCjkGlyphs(page, oracle);
  return result.mean < CJK_LIMITS.mean && result.worst < CJK_LIMITS.worst
    && result.glyphs.every(glyph => glyph.identityMargin >= -CJK_IDENTITY_EPSILON);
};
function translate(dx: number, dy: number): GrayPage {
  const page = copy();
  for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x++) {
    page.pixels[y * page.width + x] = Math.round(sampleGray(oracle, x - dx, y - dy));
  }
  return page;
}
function replaceGlyph(page: GrayPage, source: number, destination: number) {
  const cells = cjkCells(page.width), from = cells[source], to = cells[destination];
  for (let y = to.top; y < to.bottom; y++) for (let x = to.left; x < to.right; x++) {
    const sx = Math.min(from.right - 1, from.left + Math.floor((x - to.left) * (from.right - from.left) / (to.right - to.left)));
    const sy = Math.min(from.bottom - 1, from.top + Math.floor((y - to.top) * (from.bottom - from.top) / (to.bottom - to.top)));
    page.pixels[y * page.width + x] = oracle.pixels[sy * page.width + sx];
  }
}

describe('independent CJK glyph shape oracle', () => {
  it('accepts the oracle and bounded rasterizer placement without increasing shape limits', () => {
    expect(CJK_LIMITS).toEqual({ mean: 0.28, worst: 0.40 });
    expect(accepts(oracle)).toBe(true);
    for (const [dx, dy] of [[0.5, 0], [0, 0.5], [0.5, 0.5], [-0.5, -0.5], [1, 1]]) {
      expect(accepts(translate(dx, dy)), `placement ${dx},${dy}`).toBe(true);
    }
  });

  it('rejects blank pixels, even when the rest of the page is white', () => {
    const blank = copy(); blank.pixels.fill(255);
    const result = compareCjkGlyphs(blank, oracle);
    expect(result.mean).toBe(1); expect(result.worst).toBe(1);
    expect(accepts(blank)).toBe(false);
  });

  it('rejects repeated tofu outlines and repetition of one real CJK glyph', () => {
    const boxes = copy(); boxes.pixels.fill(255);
    for (const cell of cjkCells(boxes.width)) {
      for (let y = cell.top + 4; y < cell.top + 12; y++) for (let x = cell.left + 1; x < cell.right - 1; x++) {
        if (y === cell.top + 4 || y === cell.top + 11 || x === cell.left + 1 || x === cell.right - 2) boxes.pixels[y * boxes.width + x] = 0;
      }
    }
    expect(accepts(boxes)).toBe(false);
    const repeated = copy();
    for (let index = 1; index < CJK_GLYPHS.length; index++) replaceGlyph(repeated, 0, index);
    expect(accepts(repeated)).toBe(false);
  });

  it('rejects all 240 single-cell substitutions with a different real glyph', () => {
    let rejected = 0;
    for (let destination = 0; destination < CJK_GLYPHS.length; destination++) for (let source = 0; source < CJK_GLYPHS.length; source++) {
      if (source === destination) continue;
      const page = copy(); replaceGlyph(page, source, destination);
      const expected = glyphDistance(page, oracle, destination);
      const replacement = glyphDistance(page, oracle, destination, source);
      expect(expected - replacement, `${CJK_GLYPHS[destination]} replaced by ${CJK_GLYPHS[source]}`).toBeGreaterThan(CJK_IDENTITY_EPSILON);
      rejected++;
    }
    expect(rejected).toBe(240);
  });

  it.each([2, 3])('rejects %ipx displaced strokes beyond the registration bound', distance => {
    expect(accepts(translate(distance, distance))).toBe(false);
  });
});
