import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Locator, Page } from '@playwright/test';
import { test, expect, importBook, reader, quickFlip, snapshots } from './helpers';

const fixture = fileURLToPath(new URL('../fixtures/leafspace-mixed-raster.pdf', import.meta.url));
const sourceHash = createHash('sha256').update(readFileSync(fixture)).digest('hex');
const colors = { R: [220, 25, 35, 255], G: [25, 180, 45, 255], B: [30, 60, 220, 255], Y: [230, 205, 25, 255] };
const geometry = [
  { width: 420, height: 594, corners: ['R', 'G', 'B', 'Y'] },
  { width: 792, height: 612, corners: ['R', 'G', 'B', 'Y'] },
  { width: 594, height: 420, corners: ['B', 'R', 'Y', 'G'] },
  { width: 420, height: 594, corners: ['Y', 'B', 'G', 'R'] },
  { width: 594, height: 420, corners: ['G', 'Y', 'R', 'B'] },
  { width: 468, height: 624, corners: ['R', 'G', 'B', 'Y'] },
  { width: 624, height: 468, corners: ['B', 'R', 'Y', 'G'] },
  { width: 500, height: 500, corners: ['R', 'G', 'B', 'Y'] },
  { width: 200, height: 1200, corners: ['R', 'G', 'B', 'Y'] },
  { width: 1200, height: 200, corners: ['R', 'G', 'B', 'Y'] },
] as const;
async function goTo(page: Page, number: number) {
  const input = page.getByRole('textbox', { name: '输入页码', exact: true });
  await input.fill(String(number)); await input.press('Enter');
  await expect(page.locator('header')).toContainText(`第 ${number} 页`);
  await expect(reader(page).locator(`.react-pdf__Page[data-page-number="${number}"] canvas`)).toBeVisible();
}
async function canvasEvidence(region: Locator) {
  return region.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect(), frame = canvas.closest('.w-max')!.getBoundingClientRect();
    const context = canvas.getContext('2d')!;
    return { width: bounds.width, height: bounds.height, bitmapWidth: canvas.width, bitmapHeight: canvas.height,
      frameWidth: frame.width, frameHeight: frame.height, dpr: devicePixelRatio,
      corners: [[.1, .1], [.9, .1], [.1, .9], [.9, .9]].map(([x, y]) => Array.from(context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data)) };
  });
}
async function decoded(region: Locator, number: number) {
  const expected = geometry[number - 1];
  await expect(region.locator('canvas')).toBeVisible();
  await expect.poll(async () => (await canvasEvidence(region)).corners).toEqual(expected.corners.map(color => colors[color]));
  const evidence = await canvasEvidence(region);
  const ratio = expected.height / expected.width;
  // PDF.js floors physical bitmap dimensions; height:auto then follows that
  // rounded ratio. At high DPR on a 6:1 page this can exceed one CSS pixel.
  expect(Math.abs(evidence.bitmapHeight - evidence.bitmapWidth * ratio)).toBeLessThanOrEqual(Math.max(1, ratio) + .01);
  expect(Math.abs(evidence.height - evidence.width * evidence.bitmapHeight / evidence.bitmapWidth)).toBeLessThanOrEqual(.1);
  expect(Math.abs(evidence.frameWidth - evidence.width - 2)).toBeLessThanOrEqual(1);
  expect(evidence.frameHeight).toBeGreaterThanOrEqual(Math.floor(evidence.width * ratio) + 1);
  expect(evidence.frameHeight).toBeLessThanOrEqual(Math.ceil((evidence.width + 1) * ratio) + 2);
  return evidence;
}
async function thumbnailEvidence(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0);
    return { width: canvas.width, height: canvas.height,
      corners: [[.1, .1], [.9, .1], [.1, .9], [.9, .9]].map(([x, y]) => Array.from(context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data)) };
  });
}
function expectThumbnailColors(actual: number[][], expected: readonly (keyof typeof colors)[]) {
  // Worker and fallback thumbnails use lossy WebP, potentially at different sizes.
  for (const [index, key] of expected.entries()) {
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[index][channel] - colors[key][channel])).toBeLessThanOrEqual(12);
    expect(actual[index][3]).toBe(255);
  }
}
async function durableSourceHash(page: Page) {
  return page.evaluate(async () => {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const request = indexedDB.open('leafspace'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction('books', 'readonly');
        const read = transaction.objectStore('books').getAll();
        read.onsuccess = async () => { try { resolve(read.result[0].bytes ?? await read.result[0].blob.arrayBuffer()); } catch (error) { reject(error); } };
        read.onerror = () => reject(read.error); transaction.oncomplete = () => database.close(); transaction.onabort = () => database.close();
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
  });
}
async function paperPoint(region: Locator) {
  return region.evaluate(element => {
    const bounds = element.getBoundingClientRect(), paper = element.querySelector('canvas')!.getBoundingClientRect();
    return { x: (bounds.left + element.clientWidth / 2 - paper.left) / paper.width,
      y: (bounds.top + element.clientHeight / 2 - paper.top) / paper.height, width: paper.width, height: paper.height };
  });
}

async function expectAnchor(region: Locator, anchor: { x: number; y: number }) {
  await expect.poll(async () => {
    const after = await paperPoint(region);
    return Math.max(Math.abs(after.x - anchor.x) * after.width, Math.abs(after.y - anchor.y) * after.height);
  }, { message: 'The same mixed-page paper point stays at the zoom anchor' }).toBeLessThanOrEqual(2);
}

test('mixed raster pages retain their effective rotation, crop ratio and fit-width geometry', async ({ page }, info) => {
  test.setTimeout(90_000); await page.goto('/'); await importBook(page, fixture);
  const evidence = [];
  for (const number of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1]) {
    await goTo(page, number); await reader(page).locator('..').getByRole('button', { name: '恢复适合宽度', exact: true }).click();
    await expect.poll(() => reader(page).evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
    if ([2, 7, 9, 10].includes(number)) await info.attach(`mixed-page-${number}`, { body: await page.screenshot(), contentType: 'image/png' });
    const dimensions = await decoded(reader(page), number);
    evidence.push({ page: number, ...dimensions });
    if (number === 2) {
      const anchor = await paperPoint(reader(page)), baseWidth = dimensions.frameWidth - 2;
      for (let step = 1; step <= 5; step++) {
        await reader(page).locator('..').getByRole('button', { name: '放大', exact: true }).click();
        await expect.poll(() => reader(page).locator('canvas').evaluate((canvas, width) => Math.abs(canvas.getBoundingClientRect().width - width), Math.floor(baseWidth * 1.2 ** step))).toBeLessThanOrEqual(1);
        await decoded(reader(page), number); await expectAnchor(reader(page), anchor);
      }
      await reader(page).locator('..').getByRole('button', { name: '恢复适合宽度', exact: true }).click();
      await decoded(reader(page), number);
    }
    await expect.poll(() => reader(page).evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  }
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  expect(await durableSourceHash(page)).toBe(sourceHash);
  await info.attach('mixed-page-geometry', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('cropped rotated thumbnails and a zoomed reference survive reopening without changing the PDF bytes', async ({ page }, info) => {
  test.setTimeout(90_000); await page.goto('/'); await importBook(page, fixture); await goTo(page, 7);
  await page.getByRole('button', { name: /^速翻/ }).click();
  const preview = await thumbnailEvidence(quickFlip(page).getByRole('button', { name: '选择第 7 页', exact: true }).locator('img'));
  expectThumbnailColors(preview.corners, geometry[6].corners);
  expect(Math.abs(preview.height - preview.width * .75)).toBeLessThanOrEqual(1);
  await quickFlip(page).getByRole('button', { name: '夹住此页', exact: true }).click(); await page.keyboard.press('Escape');
  if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: '夹页 1', exact: true }).click();
  const held = await thumbnailEvidence(page.getByRole('complementary', { name: '夹页列表' }).getByRole('img', { name: '第 7 页缩略图', exact: true }));
  expectThumbnailColors(held.corners, geometry[6].corners); expect(Math.abs(held.height - held.width * .75)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '打开第 7 页参考窗口', exact: true }).click();
  const reference = page.getByRole('region', { name: '参考阅读区，第 7 页', exact: true });
  const referenceFitWidth = (await decoded(reference, 7)).frameWidth - 2;
  const id = await reference.locator('xpath=ancestor::*[@data-window-id][1]').getAttribute('data-window-id');
  for (let index = 0; index < 5; index++) {
    await reference.locator('..').getByRole('button', { name: '放大', exact: true }).click();
    await expect.poll(() => reference.locator('canvas').evaluate((canvas, width) => Math.abs(canvas.getBoundingClientRect().width - width), Math.floor(referenceFitWidth * 1.2 ** (index + 1)))).toBeLessThanOrEqual(1);
    await decoded(reference, 7);
  }
  await reference.evaluate(element => element.scrollTo(90, 90));
  await expect.poll(() => reference.evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual([90, 90]);
  const anchor = await paperPoint(reference);
  await reference.locator('..').getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(() => reference.locator('canvas').evaluate((canvas, width) => Math.abs(canvas.getBoundingClientRect().width - width), Math.floor(referenceFitWidth * 1.2 ** 6))).toBeLessThanOrEqual(1);
  await decoded(reference, 7);
  await expect.poll(async () => { const after = await paperPoint(reference); return Math.max(Math.abs(after.x - anchor.x) * after.width, Math.abs(after.y - anchor.y) * after.height); }).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: '保存现场', exact: true }).click(); await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const livePosition = await reference.evaluate(element => [element.scrollLeft, element.scrollTop]);
  await expect.poll(async () => { const viewport = (await snapshots(page))[0].windows.find(win => win.id === id)?.viewport; return [viewport?.scrollLeft, viewport?.scrollTop]; }).toEqual(livePosition);
  const saved = (await snapshots(page))[0], position = saved.windows.find(win => win.id === id)!.viewport!;
  expect(saved.currentPage).toBe(7); expect(saved.activeWindowId).toBe(id); expect(saved.heldPages.map(held => held.pageNumber)).toEqual([7]);
  expect(await durableSourceHash(page)).toBe(sourceHash);
  await page.reload(); await page.getByRole('button', { name: /leafspace-mixed-raster\.pdf/ }).click();
  await decoded(reference, 7);
  await expect.poll(() => reference.evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual([position.scrollLeft, position.scrollTop]);
  expect(await durableSourceHash(page)).toBe(sourceHash);
  await info.attach('mixed-cropped-reference-restored', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('mixed-thumbnail-and-saved-context', { body: JSON.stringify({ preview, held, saved }, null, 2), contentType: 'application/json' });
});

test('a tall raster page remains decoded at maximum zoom and returns to fit', async ({ page }, info) => {
  test.setTimeout(90_000); await page.goto('/'); await importBook(page, fixture); await goTo(page, 9);
  const fitWidth = (await decoded(reader(page), 9)).frameWidth - 2;
  const anchor = await paperPoint(reader(page));
  for (let index = 0; index < 8; index++) {
    await reader(page).locator('..').getByRole('button', { name: '放大', exact: true }).click();
    await expect.poll(() => reader(page).locator('canvas').evaluate((canvas, width) => Math.abs(canvas.getBoundingClientRect().width - width), Math.floor(fitWidth * Math.min(4, 1.2 ** (index + 1))))).toBeLessThanOrEqual(1);
    if (index < 7) { await decoded(reader(page), 9); await expectAnchor(reader(page), anchor); }
  }
  await expect(reader(page).locator('..').getByRole('button', { name: '放大', exact: true })).toBeDisabled();
  await expect.poll(() => reader(page).locator('canvas').evaluate((canvas, width) => Math.abs(canvas.getBoundingClientRect().width - width * 4), fitWidth)).toBeLessThanOrEqual(1);
  await expect(reader(page).locator('canvas')).toBeVisible();
  const point = await reader(page).evaluate(element => {
    const bounds = element.getBoundingClientRect(), paper = element.querySelector('canvas')!.getBoundingClientRect();
    const left = Math.max(bounds.left, paper.left), right = Math.min(bounds.left + element.clientWidth, paper.right);
    const top = Math.max(bounds.top, paper.top), bottom = Math.min(bounds.top + element.clientHeight, paper.bottom);
    return { x: left + (right - left) * .31, y: top + (bottom - top) * .37, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  // Capture the composited screen before this maximum-size canvas is read back.
  const screenshot = await page.screenshot();
  await info.attach('tall-page-maximum-zoom', { body: screenshot, contentType: 'image/png' });
  const screen = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  const pixelX = Math.floor(point.x * screen.info.width / point.viewportWidth), pixelY = Math.floor(point.y * screen.info.height / point.viewportHeight);
  const screenColor = Array.from(screen.data.subarray((pixelY * screen.info.width + pixelX) * screen.info.channels, (pixelY * screen.info.width + pixelX) * screen.info.channels + 3));
  const canvasColor = await reader(page).locator('canvas').evaluate((canvas: HTMLCanvasElement, point) => {
    const bounds = canvas.getBoundingClientRect();
    return Array.from(canvas.getContext('2d')!.getImageData(Math.floor((point.x - bounds.left) / bounds.width * canvas.width), Math.floor((point.y - bounds.top) / bounds.height * canvas.height), 1, 1).data).slice(0, 3);
  }, point);
  expect(screenColor).toEqual(canvasColor);
  const evidence = await decoded(reader(page), 9); await expectAnchor(reader(page), anchor);
  await info.attach('tall-page-canvas-dimensions', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await reader(page).locator('..').getByRole('button', { name: '恢复适合宽度', exact: true }).click(); await decoded(reader(page), 9);
  await expect.poll(() => reader(page).evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  await goTo(page, 1); await decoded(reader(page), 1);
});
