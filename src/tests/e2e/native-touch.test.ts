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
  const original = await region.evaluate(el => {
    const bounds = el.getBoundingClientRect(), paper = el.querySelector('canvas')!.getBoundingClientRect();
    return { width: paper.width, x: (bounds.left + bounds.width / 2 - paper.left) / paper.width, y: (bounds.top + bounds.height / 2 - paper.top) / paper.height };
  });
  await pinch(session, region, 2);
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('200%');
  await expect.poll(() => region.locator('canvas').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(original.width * 1.9);
  await expect.poll(() => region.evaluate((el, origin) => {
    const bounds = el.getBoundingClientRect(), paper = el.querySelector('canvas')!.getBoundingClientRect();
    return Math.max(Math.abs((bounds.left + bounds.width / 2 - paper.left) / paper.width - origin.x), Math.abs((bounds.top + bounds.height / 2 - paper.top) / paper.height - origin.y));
  }, original)).toBeLessThan(0.01);
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

test('native touch targets the reference pane and browser zoom remains available outside the reader', async ({ page }, info) => {
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
  await pinch(session, page.locator('body'), 3);
  const appScale = await page.evaluate(() => visualViewport?.scale ?? 1);
  if (appScale <= before) {
    const probe = await page.context().newPage();
    await probe.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;width:100vw;height:100vh;background:#eee">Native browser zoom probe</body>');
    const probeSession = await page.context().newCDPSession(probe);
    await pinch(probeSession, probe.locator('body'), 3);
    const rawScale = await probe.evaluate(() => visualViewport?.scale);
    await probeSession.send('Input.synthesizePinchGesture', { x: 190, y: 300, scaleFactor: 3, gestureSourceType: 'touch', relativeSpeed: 200 });
    await info.attach('independent-native-browser-zoom-probe', { body: JSON.stringify({ appScale, rawScale, synthesizedScale: await probe.evaluate(() => visualViewport?.scale), viewport: await probe.evaluate(() => ({ width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints })) }), contentType: 'application/json' });
    await probe.close();
  }
  await expect.poll(() => page.evaluate(() => visualViewport?.scale ?? 1)).toBeGreaterThan(before);
  await session.detach();
});


test('native touch timeline previews, cancels by moving away, then commits a fresh drag', async ({ page }) => {
  await page.goto('/'); await importBook(page);
  const slider = page.getByRole('slider', { name: '跳转到页码' });
  const box = await slider.boundingBox(); if (!box) throw new Error('Missing slider');
  const session = await page.context().newCDPSession(page);
  const start = { id: 1, x: box.x + 8, y: box.y + box.height / 2 };
  const target = { ...start, x: box.x + box.width * 0.7 };
  await send(session, 'touchStart', [start]); await send(session, 'touchMove', [target]);
  await expect(slider).toHaveAttribute('aria-valuetext', /^预览：/);
  await expect(page.locator('header')).toContainText('第 1 页');
  await send(session, 'touchMove', [{ ...target, y: start.y - 100 }]);
  await expect(page.getByText('松开取消 · 移回继续')).toBeVisible();
  await send(session, 'touchEnd', []);
  await expect(page.locator('header')).toContainText('第 1 页');
  await send(session, 'touchStart', [start]); await send(session, 'touchMove', [target]);
  const number = Number(await slider.inputValue()); expect(number).toBeGreaterThan(1);
  await send(session, 'touchEnd', []);
  await expect(page.locator('header')).toContainText(`第 ${number} 页`);
  await session.detach();
});

test('native touch thumbnail holds own the original release and let fresh actions and scrolls work', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await importBook(page);
  await page.getByRole('button', { name: /^速翻/ }).click();
  const session = await page.context().newCDPSession(page);
  const target = page.getByRole('button', { name: '选择第 1 页', exact: true });
  await expect(target).toBeInViewport();
  const start = async () => {
    const box = await target.boundingBox(); if (!box) throw new Error('Missing thumbnail');
    const point = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await send(session, 'touchStart', [point]); return point;
  };
  await start();
  const dialog = page.getByRole('dialog', { name: '第 1 页操作', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '阅读此页', exact: true })).toBeDisabled();
  await send(session, 'touchEnd', []);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '阅读此页', exact: true })).toBeEnabled();
  await info.attach('native-touch-thumbnail-action-sheet', { body: await page.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: '夹住此页', exact: true }).tap();
  await expect(dialog).toHaveCount(0); await expect(quickFlip(page)).toBeVisible();
  await start(); await expect(dialog).toBeVisible();
  // Escape while the original finger is still down must not turn its release
  // into a thumbnail click or a second dismissal of Quick Flip.
  await page.keyboard.press('Escape'); await send(session, 'touchEnd', []);
  await expect(dialog).toHaveCount(0); await expect(quickFlip(page)).toBeVisible();
  const point = await start();
  await send(session, 'touchMove', [{ ...point, x: point.x - 70 }]);
  await page.waitForTimeout(550); await send(session, 'touchEnd', []);
  await expect(dialog).toHaveCount(0); await expect(quickFlip(page)).toBeVisible();
  await target.scrollIntoViewIfNeeded(); await start(); await expect(dialog).toBeVisible(); await send(session, 'touchEnd', []);
  await dialog.getByRole('button', { name: '阅读此页', exact: true }).tap();
  await expect(quickFlip(page)).toHaveCount(0); await expect(reader(page).locator('canvas')).toBeVisible();
  await expect(page.locator('header')).toContainText('第 1 页');
  await session.detach();
});
