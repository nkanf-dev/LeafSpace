import { test, expect, importBook, reader, snapshots, quickFlip } from './helpers';
import type { Locator, Page } from '@playwright/test';

async function dragStart(page: Page, slider: Locator, fraction: number) {
  const box = await slider.boundingBox();
  if (!box) throw new Error('Missing slider');
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2, { steps: 6 });
}

test('timeline pointer drag previews without saving and commits on release; keyboard remains immediate', async ({ page }, info) => {
  await page.goto('/'); await importBook(page);
  const slider = page.getByRole('slider', { name: '跳转到页码' });
  await dragStart(page, slider, 0.65);
  await expect(slider).toHaveAttribute('aria-valuetext', /^预览：/);
  const target = Number(await slider.inputValue());
  expect(target).toBeGreaterThan(1);
  // Keep the preview alive longer than the real autosave debounce.
  await expect.poll(async () => (await snapshots(page)).some(snapshot => snapshot.currentPage === 1)).toBe(true);
  await page.waitForTimeout(1100);
  expect((await snapshots(page)).every(snapshot => snapshot.currentPage === 1)).toBe(true);
  await expect(page.locator('header')).toContainText('第 1 页');
  await info.attach('timeline-temporary-preview', { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.up();
  await expect(page.locator('header')).toContainText(`第 ${target} 页`);
  await expect(slider).not.toHaveAttribute('aria-valuetext', /^预览：/);
  await slider.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('header')).toContainText(`第 ${target + 1} 页`);
});

test('timeline Escape and pointer cancellation preserve reference and permit repeated drags', async ({ page }) => {
  await page.goto('/'); await importBook(page);
  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect(quickFlip(page)).toBeVisible();
  await page.keyboard.press('n');
  const reference = page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true });
  await expect(reference.locator('canvas')).toBeVisible();
  const slider = page.getByRole('slider', { name: '跳转到页码' });
  await dragStart(page, slider, 0.8); await page.keyboard.press('Escape');
  await page.mouse.move(200, 200); await page.mouse.up();
  await expect(reference).toBeVisible(); await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  await expect(slider).toHaveValue('1');
  await dragStart(page, slider, 0.6);
  await slider.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  await expect(slider).toHaveValue('1');
  await dragStart(page, slider, 0.5);
  const target = Number(await slider.inputValue());
  await page.mouse.up();
  await expect(page.getByRole('region', { name: `参考阅读区，第 ${target} 页`, exact: true }).locator('canvas')).toBeVisible();
  await expect(page.locator('header')).toContainText('第 1 页');
});

// DOM-level TouchEvents exercise every engine's event/React/PDF integration.
// Native gesture arbitration is separately covered by native-touch.test.ts (Chromium CDP).
async function touchEvent(region: Locator, type: string, points: {id:number;x:number;y:number}[], changed = points) {
  await region.evaluate((element, { type, points, changed }) => {
    const make = ({ id, x, y }: {id:number;x:number;y:number}) => ({ identifier: id, target: element, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: points.map(make) }, changedTouches: { value: changed.map(make) } });
    element.dispatchEvent(event);
  }, { type, points, changed });
}

test('touch-event contract: pinch preview is cancellable and repeated staggered pinches preserve pane ownership', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await importBook(page);
  const region = reader(page);
  const box = await region.boundingBox(); if (!box) throw new Error('Missing reader');
  const x = box.x + box.width / 2, y = box.y + Math.min(200, box.height / 2);
  const one = [{ id: 1, x: x - 40, y }], start = [...one, { id: 2, x: x + 40, y }];
  const end = [{ id: 1, x: x - 80, y }, { id: 2, x: x + 80, y }];
  await touchEvent(region, 'touchstart', one); await touchEvent(region, 'touchstart', start); await touchEvent(region, 'touchmove', end);
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('100%');
  await touchEvent(region, 'touchcancel', []);
  await expect(region.locator('.w-max')).toHaveCSS('transform', 'none');
  for (let index = 0; index < 2; index++) {
    await touchEvent(region, 'touchstart', one); await touchEvent(region, 'touchstart', start); await touchEvent(region, 'touchmove', end); await touchEvent(region, 'touchend', [], end);
    await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText(index === 0 ? '200%' : '400%');
    await expect(region.locator('canvas')).toBeVisible();
  }
  await expect(page.locator('header')).toContainText('第 1 页');
  await info.attach('touch-contract-zoomed-paper', { body: await page.screenshot(), contentType: 'image/png' });
});


test('timeline moving away cancels on release and returning to the track resumes preview', async ({ page }, info) => {
  await page.goto('/'); await importBook(page);
  const slider = page.getByRole('slider', { name: '跳转到页码' });
  const box = await slider.boundingBox(); if (!box) throw new Error('Missing slider');
  await dragStart(page, slider, 0.5);
  await page.mouse.move(box.x + box.width / 2, box.y - 100);
  await expect(page.getByText('松开取消 · 移回继续')).toBeVisible();
  await info.attach('timeline-cancel-zone', { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.up();
  await expect(page.locator('header')).toContainText('第 1 页');
  await dragStart(page, slider, 0.6);
  await page.mouse.move(box.x + box.width / 2, box.y - 100);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const target = Number(await slider.inputValue());
  await expect(page.getByText('松开跳转 · 移开取消')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('header')).toContainText(`第 ${target} 页`);
});
