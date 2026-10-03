import type { Locator } from '@playwright/test';
import { test, expect, importBook, reader, quickFlip } from './helpers';

async function sampleFrames(region: Locator, count: number) {
  return region.evaluate(async (element, count) => {
    const samples = [];
    for (let index = 0; index < count; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const canvas = element.querySelector('canvas')!, frame = element.querySelector<HTMLElement>('.w-max')!;
      const paper = canvas.getBoundingClientRect(), bounds = element.getBoundingClientRect(), frameBounds = frame.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      samples.push({ clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
        frameWidth: frameBounds.width, frameHeight: frameBounds.height,
        canvasWidth: paper.width, canvasHeight: paper.height, bitmapWidth: canvas.width, bitmapHeight: canvas.height,
        frameCenterDelta: frameBounds.x + frameBounds.width / 2 - bounds.x - element.clientWidth / 2,
        visibility: style.visibility, display: style.display, opacity: style.opacity, overflowY: getComputedStyle(element).overflowY });
    }
    return samples;
  }, count);
}
async function decodedPixels(region: Locator) {
  return region.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.floor(canvas.width * x / 420), Math.floor(canvas.height * y / 594), 1, 1).data);
    return { background: pixel(10, 10), rectangle: pixel(50, 394) };
  });
}
function expectPixels(pixels: Awaited<ReturnType<typeof decodedPixels>>) {
  expect(pixels.background).toEqual([240, 237, 224, 255]);
  expect(pixels.rectangle).toEqual([51, 128, 76, 255]);
}

test('fit width includes paper borders at narrow, breakpoint and wide sizes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await importBook(page);
  const region = reader(page), measurements = [];
  try {
    for (const width of [390, 639, 640, 720, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: '恢复适合宽度', exact: true }).click();
      await expect(region.locator('canvas')).toBeVisible();
      await expect.poll(() => region.evaluate(element => Math.abs(element.querySelector('canvas')!.getBoundingClientRect().width - Math.floor(Math.min(612, Math.max(1, element.clientWidth - (innerWidth < 640 ? 32 : 80) - 2)))))).toBeLessThan(0.1);
      await expect.poll(() => region.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
      const [geometry] = await sampleFrames(region, 1);
      expect(Math.abs(geometry.frameCenterDelta)).toBeLessThanOrEqual(0.5);
      expect(geometry.frameWidth).toBe(geometry.canvasWidth + 2);
      expect(geometry.overflowY).toBe('scroll');
      // Capture the actual screen before readback so it cannot hide a bad paint.
      await info.attach(`fit-width-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      const pixels = await decodedPixels(region);
      measurements.push({ width, geometry, pixels });
      expectPixels(pixels);
    }
  } finally {
    await info.attach('fit-width-geometry', { body: JSON.stringify(measurements), contentType: 'application/json' });
  }
});

test('fit width stays rendered and stable through scrollbar-height boundaries', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto('/'); await importBook(page);
  const region = reader(page), measurements = [];
  try {
    for (const height of [844, 839, 844, 854, 844]) {
      await page.setViewportSize({ width: 390, height });
      const samples = await sampleFrames(region, 120);
      const tail = samples.slice(-60);
      await info.attach(`fit-height-${height}-${measurements.length}`, { body: await page.screenshot(), contentType: 'image/png' });
      const pixels = await decodedPixels(region);
      measurements.push({ height, samples, pixels });
      expect.soft(new Set(tail.map(sample => JSON.stringify(sample))).size, `Stable final 60 frames at height ${height}`).toBe(1);
      expect.soft(tail.every(sample => sample.scrollWidth === sample.clientWidth && sample.visibility === 'visible'
        && sample.display !== 'none' && sample.opacity === '1' && sample.canvasWidth > 0 && sample.canvasHeight > 0
        && sample.bitmapWidth > 0 && sample.bitmapHeight > 0 && sample.overflowY === 'scroll'), `Visible stable paper at height ${height}`).toBe(true);
      expectPixels(pixels);
    }
  } finally {
    await info.attach('fit-height-stability', { body: JSON.stringify(measurements), contentType: 'application/json' });
  }
});

test('every grid pane fits without horizontal scrolling and still zooms independently', async ({ page }, info) => {
  test.skip(['tablet', 'mobile', 'mobile-webkit'].includes(info.project.name), 'Side-by-side desktop grid; compact fit and native touch have separate coverage');
  await page.goto('/'); await importBook(page);
  for (let index = 0; index < 4; index++) {
    await page.getByRole('button', { name: /^速翻/ }).click(); await expect(quickFlip(page)).toBeVisible();
    await page.keyboard.press('n'); await expect(page.locator('[data-floating-window]')).toHaveCount(index + 1);
  }
  await page.getByRole('combobox', { name: '工作区布局' }).selectOption('grid');
  const regions = page.locator('[data-reader-pane] [role="region"]'); await expect(regions).toHaveCount(5);
  const measurements = [];
  for (const region of await regions.all()) {
    await expect(region.locator('canvas')).toBeVisible();
    await expect.poll(() => region.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
    const [geometry] = await sampleFrames(region, 1); measurements.push(geometry);
    expect(Math.abs(geometry.frameCenterDelta)).toBeLessThanOrEqual(0.5);
  }
  await info.attach('fit-five-page-grid', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('fit-grid-geometry', { body: JSON.stringify(measurements), contentType: 'application/json' });
  for (const region of await regions.all()) expectPixels(await decodedPixels(region));
  const reference = regions.nth(1);
  await reference.locator('..').getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(() => reference.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(20);
  await expect(reader(page).locator('..').getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText('100%');
});
