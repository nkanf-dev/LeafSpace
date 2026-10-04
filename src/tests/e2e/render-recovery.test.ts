import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect, importBook, reader, quickFlip, snapshots } from './helpers';

const fixture = fileURLToPath(new URL('../fixtures/leafspace-render-recovery.pdf', import.meta.url));
const sourceHash = createHash('sha256').update(readFileSync(fixture)).digest('hex');
type FaultState = { target: string; page: number; remaining: number; hits: number; draws: number; tracking: boolean; workers: number };
// This semantic toolbar relation also works against the unchanged baseline.
const controls = (region: Locator) => region.locator('xpath=ancestor::*[.//button[@aria-label="恢复适合宽度"]][1]');
async function installFault(page: Page) {
  await page.addInitScript(() => {
    const state = { target: '', page: 1, remaining: 0, hits: 0, draws: 0, tracking: false, workers: 0 };
    Object.assign(window, { leafspaceRasterFault: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); state.workers++; }
    };
    const original = CanvasRenderingContext2D.prototype.drawImage;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'drawImage', { configurable: true, writable: true,
      value: function(this: CanvasRenderingContext2D, ...args: unknown[]) {
        const canvas = this.canvas;
        if (state.tracking && canvas.classList.contains('react-pdf__Page__canvas')
          && canvas.closest('[role="region"]')?.getAttribute('aria-label') === state.target
          && Number(canvas.closest('.react-pdf__Page')?.getAttribute('data-page-number')) === state.page) {
          state.draws++;
          if (state.remaining > 0) { state.remaining--; state.hits++; throw new Error('Synthetic page rasterization failure'); }
        }
        return Reflect.apply(original, this, args);
      },
    });
  });
}
async function state(page: Page) {
  return page.evaluate(() => ({ ...(window as unknown as { leafspaceRasterFault: FaultState }).leafspaceRasterFault }));
}
async function arm(page: Page, region: Locator, remaining = 1) {
  const target = await region.getAttribute('aria-label');
  await page.evaluate(({ target, remaining }) => Object.assign((window as unknown as { leafspaceRasterFault: FaultState }).leafspaceRasterFault,
    { target, remaining, hits: 0, draws: 0, tracking: true }), { target, remaining });
}
async function decoded(region: Locator) {
  await expect(region.locator('canvas')).toBeVisible();
  await expect.poll(() => region.locator('canvas').evaluate((canvas: HTMLCanvasElement) => [0.25, 0.75, 0.5].map(y =>
    Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * y), 1, 1).data))))
    .toEqual([[210, 40, 40, 255], [20, 130, 40, 255], [255, 255, 255, 255]]);
}
async function sourceBytesHash(page: Page) {
  return page.evaluate(async () => {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const opening = indexedDB.open('leafspace'); opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('books', 'readonly'), request = tx.objectStore('books').getAll();
        request.onsuccess = async () => { try { resolve(request.result[0].bytes ?? await request.result[0].blob.arrayBuffer()); } catch (error) { reject(error); } };
        request.onerror = () => reject(request.error); tx.oncomplete = () => db.close(); tx.onabort = () => db.close();
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
async function checkpoint(page: Page) {
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const saved = (await snapshots(page))[0];
  return { documentId: saved.documentId, currentPage: saved.currentPage, scale: saved.scale, heldPages: saved.heldPages, windows: saved.windows, activeWindowId: saved.activeWindowId };
}
async function holdFixturePage(page: Page) {
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  const narrow = page.viewportSize()!.width < 1024;
  if (narrow) await page.getByRole('button', { name: '夹页 1', exact: true }).click();
  const image = page.getByRole('img', { name: '第 1 页缩略图', exact: true });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 60)).toBe(true);
  if (narrow) await page.getByRole('button', { name: '← 返回阅读', exact: true }).click();
  await decoded(reader(page));
}
async function visibleFailure(page: Page, region: Locator, hits: number) {
  await expect.poll(async () => (await state(page)).hits).toBe(hits);
  await expect(region.locator('canvas')).toHaveCSS('visibility', 'hidden');
  const alert = controls(region).getByRole('alert');
  await expect(alert).toContainText('暂时无法显示');
  await expect(region.locator('.annotationLayer a')).toBeVisible();
  return alert;
}
async function assertHit(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  expect(await button.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return hit === element || element.contains(hit);
  }), 'Retry owns its native hit target above the real PDF annotation/text layers').toBe(true);
}
async function recoveredScreen(page: Page, region: Locator) {
  await expect(controls(region).getByRole('alert')).toHaveCount(0);
  await expect(controls(region).getByText(/正在重试第/)).toHaveCount(0);
  await expect(region.locator('canvas')).toBeVisible();
  await page.mouse.move(5, 5); // Do not tint the page through the full-page test link's hover style.
  const point = await region.evaluate(element => {
    const view = element.getBoundingClientRect(), paper = element.querySelector('canvas')!.getBoundingClientRect();
    const candidates = [[20, 121, [210, 40, 40]], [136, 236, [20, 130, 40]]] as const;
    const areas = candidates.map(([topFraction, bottomFraction, color]) => {
      const left = Math.max(view.left, paper.left + paper.width * 20 / 256), right = Math.min(view.left + element.clientWidth, paper.left + paper.width * 236 / 256);
      const top = Math.max(view.top, paper.top + paper.height * topFraction / 256), bottom = Math.min(view.top + element.clientHeight, paper.top + paper.height * bottomFraction / 256);
      return { x: (left + right) / 2, y: (top + bottom) / 2, area: Math.max(0, right - left) * Math.max(0, bottom - top), color };
    }).sort((a, b) => b.area - a.area);
    if (!areas[0].area) throw new Error('No colored raster area is visible');
    return { ...areas[0], width: innerWidth, height: innerHeight };
  });
  // A screenshot precedes the first readback of this newly retried canvas.
  const screenshot = await page.screenshot();
  const png = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(point.x * png.info.width / point.width), y = Math.floor(point.y * png.info.height / point.height);
  const offset = (y * png.info.width + x) * png.info.channels;
  expect(Array.from(png.data.subarray(offset, offset + 3))).toEqual(point.color);
  await decoded(region);
  return screenshot;
}

for (const mode of ['grab', 'pointer'] as const) {
  test(`a rejected raster has explicit keyboard-safe Retry above PDF layers in ${mode} mode`, async ({ page }, info) => {
    await installFault(page); await page.goto('/'); await importBook(page, fixture); await decoded(reader(page));
    await holdFixturePage(page);
    if (mode === 'pointer') await page.getByRole('button', { name: '选择文字', exact: true }).click();
    const documentNode = await reader(page).locator('.react-pdf__Document').elementHandle();
    await arm(page, reader(page));
    await page.getByRole('button', { name: '放大', exact: true }).click();
    const alert = await visibleFailure(page, reader(page), 1);
    const failedCanvas = await reader(page).locator('canvas').elementHandle();
    const button = alert.getByRole('button', { name: '重试此页', exact: true });
    await reader(page).focus();
    for (let step = 0; step < 6 && !(await button.evaluate(element => element === document.activeElement)); step++) await page.keyboard.press('Tab');
    await expect(button).toBeFocused(); await expect(button).toHaveCSS('outline-style', 'solid'); await assertHit(button);
    // Native Tab may scroll the oversized PDF link before reaching Retry. That
    // newer reading intent, rather than the pre-navigation offset, must survive.
    const before = await checkpoint(page), beforeFault = await state(page);
    await button.focus();
    const position = await reader(page).evaluate(element => [element.scrollLeft, element.scrollTop]);
    await info.attach(`raster-failure-${mode}`, { body: await page.screenshot(), contentType: 'image/png' });
    if (mode === 'grab') await page.keyboard.press('Space'); else await button.click();
    const screenshot = await recoveredScreen(page, reader(page));
    await expect(reader(page)).toBeFocused(); await expect(quickFlip(page)).toHaveCount(0);
    expect(await failedCanvas!.evaluate(element => element.isConnected)).toBe(false);
    expect(await documentNode!.evaluate(element => element.isConnected)).toBe(true);
    expect((await state(page)).workers).toBe(beforeFault.workers);
    await expect.poll(() => reader(page).evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual(position);
    expect(await checkpoint(page)).toEqual(before); expect(await sourceBytesHash(page)).toBe(sourceHash);
    expect((await state(page)).hits).toBe(1);
    await reader(page).focus(); await page.keyboard.press('Space'); await expect(quickFlip(page)).toBeVisible();
    await page.keyboard.press('Escape'); await expect(quickFlip(page)).toHaveCount(0); await expect(reader(page)).toBeFocused();
    await info.attach(`raster-recovered-${mode}`, { body: screenshot, contentType: 'image/png' });
  });
}

test('repeated failures require separate explicit attempts and retain deep 400% reading state', async ({ page }, info) => {
  test.setTimeout(90_000); await installFault(page); await page.goto('/'); await importBook(page, fixture); await decoded(reader(page));
  for (let step = 0; step < 7; step++) { await page.getByRole('button', { name: '放大', exact: true }).click(); await decoded(reader(page)); }
  await reader(page).evaluate(element => element.scrollTo(180, 300));
  await expect.poll(() => reader(page).evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual([180, 300]);
  await arm(page, reader(page), 2); await page.getByRole('button', { name: '放大', exact: true }).click();
  let alert = await visibleFailure(page, reader(page), 1); const before = await checkpoint(page), beforeFault = await state(page);
  const position = await reader(page).evaluate(element => [element.scrollLeft, element.scrollTop]);
  await alert.getByRole('button', { name: '重试此页', exact: true }).click();
  alert = await visibleFailure(page, reader(page), 2);
  await alert.getByRole('button', { name: '重试此页', exact: true }).focus(); await page.keyboard.press('Enter');
  const screenshot = await recoveredScreen(page, reader(page));
  await expect(page.getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText('400%');
  await expect.poll(() => reader(page).evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual(position);
  expect((await state(page)).workers).toBe(beforeFault.workers); expect((await state(page)).hits).toBe(2);
  expect(await checkpoint(page)).toEqual(before); expect(await sourceBytesHash(page)).toBe(sourceHash);
  await info.attach('deep-raster-recovery', { body: screenshot, contentType: 'image/png' });
});

test('a short 320px reader keeps Retry reachable and lets navigation leave a failed page', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 420 }); await installFault(page); await page.goto('/'); await importBook(page, fixture); await decoded(reader(page));
  await arm(page, reader(page)); await page.getByRole('button', { name: '放大', exact: true }).click();
  const alert = await visibleFailure(page, reader(page), 1), button = alert.getByRole('button', { name: '重试此页', exact: true });
  await button.focus(); await assertHit(button);
  const box = await button.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(420);
  const result = await new AxeBuilder({ page }).include('[role="alert"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
  await info.attach('short-reader-render-failure', { body: await page.screenshot(), contentType: 'image/png' });
  await reader(page).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('header')).toContainText('第 2 页'); await decoded(reader(page));
  await expect(controls(reader(page)).getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('header')).toContainText('第 1 页'); await decoded(reader(page));
  await expect(controls(reader(page)).getByRole('alert')).toHaveCount(0);
});

test('Retry remains full sized at the minimum 10% paper scale', async ({ page }, info) => {
  await installFault(page); await page.goto('/'); await importBook(page, fixture); await decoded(reader(page));
  for (let step = 0; step < 10; step++) await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText('11%');
  await decoded(reader(page)); await arm(page, reader(page));
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  const alert = await visibleFailure(page, reader(page), 1), button = alert.getByRole('button', { name: '重试此页', exact: true });
  await expect(page.getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText('10%');
  await assertHit(button); const bounds = await button.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(40);
  await info.attach('minimum-scale-raster-failure', { body: await page.screenshot(), contentType: 'image/png' });
  await button.click(); await recoveredScreen(page, reader(page));
  await expect(page.getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText('10%');
  await expect(reader(page)).toBeFocused(); expect((await state(page)).hits).toBe(1);
});

test('a background reference raster failure stays local and Retry activates only its pane', async ({ page }, info) => {
  test.skip(['tablet', 'mobile', 'mobile-webkit'].includes(info.project.name), 'Simultaneously visible desktop reference; compact recovery is covered separately');
  await page.setViewportSize({ width: 1440, height: 1000 }); await installFault(page); await page.goto('/');
  await importBook(page, fixture); await decoded(reader(page));
  await page.getByRole('button', { name: /^速翻/ }).click(); await expect(quickFlip(page)).toBeVisible();
  await page.keyboard.press('n'); await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  await page.getByRole('combobox', { name: '工作区布局' }).selectOption('grid');
  const reference = page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true });
  await decoded(reference); await reader(page).focus(); await page.keyboard.press('ArrowRight'); await decoded(reader(page));
  await expect(page.locator('header')).toContainText('第 2 页');
  const documentNode = await reference.locator('.react-pdf__Document').elementHandle();
  await arm(page, reference); await page.setViewportSize({ width: 1280, height: 1000 });
  const alert = await visibleFailure(page, reference, 1);
  await expect(reader(page)).toBeFocused(); await decoded(reader(page));
  await expect(controls(reader(page)).getByRole('alert')).toHaveCount(0);
  const before = await checkpoint(page), beforeFault = await state(page);
  await alert.getByRole('button', { name: '重试此页', exact: true }).click();
  const screenshot = await recoveredScreen(page, reference); await expect(reference).toBeFocused();
  const after = await checkpoint(page), referenceWindow = after.windows.find(window => window.id !== 'main')!;
  expect(after.activeWindowId).toBe(referenceWindow.id); expect(referenceWindow.pageNumber).toBe(1);
  expect(after.currentPage).toBe(2); expect(after.heldPages).toEqual(before.heldPages);
  expect(after.windows.map(window => ({ ...window, isActive: false }))).toEqual(before.windows.map(window => ({ ...window, isActive: false })));
  expect(after.documentId).toBe(before.documentId); expect(await sourceBytesHash(page)).toBe(sourceHash);
  expect(await documentNode!.evaluate(element => element.isConnected)).toBe(true);
  expect((await state(page)).workers).toBe(beforeFault.workers); expect((await state(page)).hits).toBe(1);
  await expect(controls(reader(page)).getByRole('alert')).toHaveCount(0);
  await info.attach('reference-raster-recovery', { body: screenshot, contentType: 'image/png' });
});
