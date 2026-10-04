import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { test, expect, importBook, reader, quickFlip } from './helpers';

const fixturePath = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const embedded = fixturePath('embedded-cjk-identity-h.pdf');
const nonembedded = fixturePath('nonembedded-cjk-unigb.pdf');
// Independently rasterized by Poppler, never captured from PDF.js or a browser.
const golden = readFileSync(fixturePath('embedded-cjk-poppler-1000.png'));
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const version = JSON.parse(readFileSync(join(pdfjsRoot, 'package.json'), 'utf8')).version as string;
const glyphRows = ['中文汉字页境测试', '简体繁體縮圖预览'];
const limits = { mean: 0.28, worst: 0.40 };

type FontEvidence = {
  customCreated: number;
  customBlocked: number;
  successes: { pageNumber: number; width: number; height: number }[];
  errors: { type: string; error?: string }[];
  domEncodes: number;
};

async function isolateFonts(page: Page, forceFallback = false) {
  const requests: string[] = [];
  page.context().on('request', request => {
    if (/\/(cmaps|standard_fonts)\//.test(request.url())) requests.push(request.url());
  });
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('failed'));
  await page.addInitScript(({ forceFallback }) => {
    const evidence = { customCreated: 0, customBlocked: 0, successes: [] as { pageNumber: number; width: number; height: number }[], errors: [] as { type: string; error?: string }[], domEncodes: 0 };
    Object.assign(window, { leafspaceFontEvidence: evidence });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const custom = String(url).includes('thumbnail.worker');
        if (custom && forceFallback) {
          evidence.customBlocked++;
          throw new Error('Synthetic custom-worker unavailable');
        }
        super(url, options);
        if (!custom) return;
        evidence.customCreated++;
        this.addEventListener('message', event => {
          if (event.data?.type === 'success') {
            const { pageNumber, width, height } = event.data;
            evidence.successes.push({ pageNumber, width, height });
          }
          if (event.data?.type === 'error' || event.data?.type === 'document-error') {
            evidence.errors.push({ type: event.data.type, error: event.data.error });
          }
        });
      }
    };
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === 'image/webp') evidence.domEncodes++;
      return nativeToBlob.call(this, callback, type, quality);
    };
  }, { forceFallback });
  return requests;
}

async function fontEvidence(page: Page): Promise<FontEvidence> {
  return page.evaluate(() => (window as unknown as { leafspaceFontEvidence: FontEvidence }).leafspaceFontEvidence);
}

async function readerReady(page: Page) {
  const canvas = reader(page).locator('canvas');
  await expect(canvas).toBeVisible();
  // Exclude React-PDF's initial 300x150 canvas and its hidden in-flight render.
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
    element.width > 0 && Math.abs(element.width / element.height - 600 / 360) < 0.02
      && getComputedStyle(element).visibility === 'visible')).toBe(true);
  return canvas;
}

async function thumbnailReady(page: Page) {
  await page.getByRole('button', { name: /^速翻/ }).click();
  const image = quickFlip(page).getByRole('button', { name: '选择第 1 页', exact: true }).locator('img');
  await expect(image).toBeVisible();
  // A cached 60px held-page image must not stand in for the actual 170px frame.
  await expect.poll(() => image.evaluate((element: HTMLImageElement) =>
    element.complete && element.naturalWidth === 170 && element.naturalHeight === 102)).toBe(true);
  return image;
}

async function bitmapPng(element: Locator) {
  const url = await element.evaluate((source: HTMLCanvasElement | HTMLImageElement) => {
    if (source instanceof HTMLCanvasElement) return source.toDataURL('image/png');
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(url.split(',')[1], 'base64');
}

async function glyphErrors(png: Buffer) {
  const metadata = await sharp(png).metadata();
  // Downsample the large reader; preserve native thumbnail resolution. Resizing
  // both against the 1000px oracle avoids amplifying thumbnail antialiasing.
  const width = Math.min(240, metadata.width!);
  const height = Math.round(width * 360 / 600);
  const normalize = (input: Buffer) => sharp(input).flatten({ background: 'white' })
    .resize(width, height).greyscale().raw().toBuffer();
  const [actual, expected] = await Promise.all([normalize(png), normalize(golden)]);
  const glyphs = glyphRows.flatMap((text, row) => Array.from(text, (glyph, column) => {
    // Original page coordinates: 32pt full-width glyphs, x=50, baselines=280/210.
    // Each cell contains the full glyph and a small vertical margin, not the
    // mostly white page. Normalize by ink, so white/tofu cannot be a success.
    const left = Math.floor((50 + column * 32) * width / 600);
    const right = Math.floor((50 + (column + 1) * 32) * width / 600);
    const top = Math.floor((42.5 + row * 70) * width / 600);
    const bottom = Math.ceil((95 + row * 70) * width / 600);
    let difference = 0, ink = 0, referenceInk = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = y * width + x;
      const observed = 255 - actual[index], reference = 255 - expected[index];
      difference += Math.abs(observed - reference);
      ink += observed + reference;
      referenceInk += reference;
    }
    expect(referenceInk, `The independent oracle contains ${glyph}`).toBeGreaterThan(255);
    return { glyph, row, error: ink ? difference / ink : 1 };
  }));
  return { width, height, glyphs, mean: glyphs.reduce((sum, item) => sum + item.error, 0) / glyphs.length, worst: Math.max(...glyphs.map(item => item.error)) };
}

async function expectCjkGlyphs(element: Locator, label: string, info: TestInfo) {
  const png = await bitmapPng(element);
  const errors = await glyphErrors(png);
  await info.attach(`${label}-pixels`, { body: png, contentType: 'image/png' });
  await info.attach(`${label}-glyph-errors`, { body: JSON.stringify({ limits, ...errors }, null, 2), contentType: 'application/json' });
  expect(errors.mean, `${label}: average CJK shape error against independent Poppler`).toBeLessThan(limits.mean);
  for (const item of errors.glyphs) {
    expect(item.error, `${label}: row ${item.row + 1} glyph ${item.glyph} retains its strokes`).toBeLessThan(limits.worst);
  }
}

test('embedded CJK strokes match independent Poppler pixels in the main reader', async ({ page }, info) => {
  await isolateFonts(page);
  await page.goto('./'); await importBook(page, embedded);
  await expectCjkGlyphs(await readerReady(page), 'main-reader', info);
});

for (const fallback of [false, true]) {
  test(`embedded CJK strokes match Poppler in the ${fallback ? 'forced DOM fallback' : 'custom worker'} thumbnail`, async ({ page }, info) => {
    await isolateFonts(page, fallback);
    await page.goto('./'); await importBook(page, embedded); await readerReady(page);
    const image = await thumbnailReady(page);
    const evidence = await fontEvidence(page);
    await info.attach('font-renderer-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    if (fallback) {
      expect(evidence.customBlocked).toBeGreaterThan(0);
      expect(evidence.customCreated).toBe(0);
      expect(evidence.successes).toEqual([]);
      expect(evidence.domEncodes).toBeGreaterThan(0);
    } else {
      expect(evidence.customCreated).toBe(1);
      expect(evidence.successes).toContainEqual({ pageNumber: 1, width: 170, height: 102 });
      expect(evidence.errors).toEqual([]);
      expect(evidence.domEncodes, 'A main-thread fallback cannot mask worker failure').toBe(0);
    }
    await expectCjkGlyphs(image, fallback ? 'dom-thumbnail' : 'worker-thumbnail', info);
  });
}

test('nonembedded CJK uses local CMaps and explicitly falls back from the worker', async ({ page }, info) => {
  const requests = await isolateFonts(page);
  await page.goto('./'); await importBook(page, nonembedded); await readerReady(page);
  await thumbnailReady(page);
  const evidence = await fontEvidence(page);
  await info.attach('nonembedded-font-routing', { body: JSON.stringify({ evidence, requests }, null, 2), contentType: 'application/json' });
  expect(evidence.customCreated).toBe(1);
  expect(evidence.errors.some(item => item.error?.includes('main-thread font renderer'))).toBe(true);
  expect(evidence.successes, 'Missing font files must not return successful worker tofu').toEqual([]);
  expect(evidence.domEncodes).toBeGreaterThan(0);
  expect(requests.some(url => url.endsWith('/UniGB-UCS2-H.bcmap'))).toBe(true);
  const localDirectory = new URL(`pdfjs/${version}/`, page.url()).href;
  for (const url of requests) expect(url.startsWith(localDirectory), url).toBe(true);
  // Deliberately no visual-quality claim here: CI's system CJK font is not pinned.
});

test('served CMaps and standard fonts match the installed PDF.js bytes', async ({ request, baseURL }) => {
  for (const name of ['cmaps/UniGB-UCS2-H.bcmap', 'cmaps/Adobe-GB1-UCS2.bcmap', 'cmaps/LICENSE', 'standard_fonts/FoxitSerif.pfb', 'standard_fonts/LiberationSans-Regular.ttf', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION']) {
    const response = await request.get(new URL(`pdfjs/${version}/${name}`, baseURL).href);
    expect(response.status(), name).toBe(200);
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(digest(await response.body()), `${name} must not be SPA fallback HTML`).toBe(digest(readFileSync(join(pdfjsRoot, name))));
  }
});
