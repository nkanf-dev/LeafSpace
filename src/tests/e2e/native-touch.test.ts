import { test, expect, importBook, reader, quickFlip } from './helpers';
import type { CDPSession, Locator } from '@playwright/test';

type Contact = { id: number; x: number; y: number };
async function send(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: Contact[]) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints });
}
async function swipe(session: CDPSession, region: Locator, dx: number, dy = 0) {
  const box = await region.boundingBox(); if (!box) throw new Error('Missing reader');
  const start = { id: 1, x: box.x + box.width / 2 - dx / 2, y: box.y + box.height / 2 - dy / 2 };
  await send(session, 'touchStart', [start]);
  for (let i = 1; i <= 20; i++) await send(session, 'touchMove', [{ ...start, x: start.x + dx * i / 20, y: start.y + dy * i / 20 }]);
  await send(session, 'touchEnd', []);
}
async function pinch(session: CDPSession, region: Locator, factor: number, cancel = false) {
  const box = await region.boundingBox(); if (!box) throw new Error('Missing reader');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const a = { id: 1, x: x - 40, y }, b = { id: 2, x: x + 40, y };
  await send(session, 'touchStart', [a]);
  await send(session, 'touchStart', [a, b]);
  for (let i = 1; i <= 6; i++) {
    const span = 40 * (1 + (factor - 1) * i / 6);
    await send(session, 'touchMove', [{ ...a, x: x - span }, { ...b, x: x + span }]);
  }
  await send(session, cancel ? 'touchCancel' : 'touchEnd', []);
}

test('native touch: swipes turn, pinch zooms paper, native panning stays local, repeated and canceled input is safe', async ({ page }, info) => {
  await page.goto('/'); await importBook(page);
  const session = await page.context().newCDPSession(page);
  const region = reader(page);
  await swipe(session, region, -140);
  await expect(page.locator('header')).toContainText('第 2 页');
  await swipe(session, region, 140);
  await expect(page.locator('header')).toContainText('第 1 页');
  await pinch(session, region, 2, true);
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('100%');
  await pinch(session, region, 2);
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('200%');
  await expect.poll(() => region.evaluate(el => el.scrollWidth > el.clientWidth + 50)).toBe(true);
  await expect.poll(() => page.evaluate(() => visualViewport?.scale)).toBe(1);
  const top = await region.evaluate(el => el.scrollTop);
  await swipe(session, region, 0, -140);
  await expect.poll(() => region.evaluate(el => el.scrollTop)).toBeGreaterThan(top);
  const left = await region.evaluate(el => el.scrollLeft);
  await swipe(session, region, -100);
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(left);
  await expect(page.locator('header')).toContainText('第 1 页');
  await pinch(session, region, 0.75);
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('150%');
  await info.attach('native-touch-zoom-and-pan', { body: await page.screenshot(), contentType: 'image/png' });
  await session.detach();
});

test('native touch targets the reference pane and browser zoom remains available outside the reader', async ({ page }) => {
  await page.goto('/'); await importBook(page);
  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect(quickFlip(page)).toBeVisible();
  await page.keyboard.press('n');
  const region = page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true });
  await expect(region.locator('canvas')).toBeVisible();
  const session = await page.context().newCDPSession(page);
  await swipe(session, region, -120);
  const reference = page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true });
  await expect(reference.locator('canvas')).toBeVisible();
  await expect(page.locator('header')).toContainText('第 1 页');
  await pinch(session, reference, 1.5);
  await expect(page.locator('[data-floating-window]').getByRole('button', { name: '恢复适合宽度' })).toHaveText('150%');
  await page.getByRole('button', { name: '回到书库' }).click();
  await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
  const before = await page.evaluate(() => visualViewport?.scale ?? 1);
  await pinch(session, page.locator('body'), 1.5);
  await expect.poll(() => page.evaluate(() => visualViewport?.scale ?? 1)).toBeGreaterThan(before);
  await session.detach();
});
