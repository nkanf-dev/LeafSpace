import { test, expect, importBook, reader, reopenRecent, snapshots } from './helpers';
import type { Locator } from '@playwright/test';

async function paperPoint(region: Locator, x = 0.5, y = 0.5) {
  return region.evaluate((element, point) => {
    const bounds = element.getBoundingClientRect();
    const paper = element.querySelector('canvas')!.getBoundingClientRect();
    return { x: (bounds.left + element.clientWidth * point.x - paper.left) / paper.width,
      y: (bounds.top + element.clientHeight * point.y - paper.top) / paper.height,
      width: paper.width, height: paper.height, left: element.scrollLeft, top: element.scrollTop };
  }, { x, y });
}
async function expectPoint(region: Locator, before: {x: number; y: number}, x = 0.5, y = 0.5) {
  await expect(region.locator('canvas')).toBeVisible();
  await expect.poll(async () => {
    const after = await paperPoint(region, x, y);
    return Math.max(Math.abs(after.x - before.x) * after.width, Math.abs(after.y - before.y) * after.height);
  }, { message: 'The same paper point stays at the zoom anchor' }).toBeLessThanOrEqual(2);
}
async function zoom(region: Locator, name: '放大' | '缩小') {
  const before = await paperPoint(region);
  await region.locator('..').getByRole('button', { name, exact: true }).click();
  await expect.poll(async () => Math.abs((await paperPoint(region)).width - before.width * (name === '放大' ? 1.2 : 0.8))).toBeLessThan(2);
  await expect(region.locator('canvas')).toBeVisible();
}

test('toolbar zoom preserves the visible paper center after scrolling and reload, in both panes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto('/'); await importBook(page);
  await page.getByRole('button', { name: /^速翻/ }).click();
  await page.keyboard.press('n');
  await expect(page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true }).locator('canvas')).toBeVisible();
  await page.locator('[data-floating-window]').getByRole('button', { name: '吸附', exact: true }).click();
  for (const region of [reader(page), page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true })]) {
    for (let i = 0; i < 5; i++) await zoom(region, '放大');
    await region.evaluate(element => element.scrollTo(150, 300));
    const before = await paperPoint(region);
    for (const name of ['放大', '缩小', '放大', '缩小'] as const) {
      await zoom(region, name);
      await expectPoint(region, before);
    }
  }
  await expect.poll(async () => (await snapshots(page))[0]?.windows.every(win => (win.viewport?.scrollTop ?? 0) > 0)).toBe(true);
  await reopenRecent(page);
  const before = await paperPoint(reader(page));
  await zoom(reader(page), '放大'); await expectPoint(reader(page), before);
  await info.attach('anchored-toolbar-zoom', { body: await page.screenshot(), contentType: 'image/png' });
});

test('repeated wheel zoom preserves its paper point while PDF renders are pending', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto('/'); await importBook(page);
  const region = reader(page);
  for (let i = 0; i < 5; i++) await zoom(region, '放大');
  await region.evaluate(element => element.scrollTo(250, 450));
  const before = await paperPoint(region, 0.4, 0.45);
  await region.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (let i = 0; i < 3; i++) element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120,
      clientX: bounds.left + element.clientWidth * 0.4, clientY: bounds.top + element.clientHeight * 0.45 }));
  });
  await expect.poll(async () => Math.abs((await paperPoint(region)).width - before.width * 1.15 ** 3)).toBeLessThan(2);
  await expectPoint(region, before, 0.4, 0.45);
});


test('zoom anchors remain stable across fit-to-overflow transitions at narrow and wide sizes', async ({ page }, info) => {
  await page.goto('/'); await importBook(page);
  const region = reader(page);
  for (const size of [{ width: 390, height: 844 }, { width: 1100, height: 780 }]) {
    await page.setViewportSize(size);
    await region.locator('..').getByRole('button', { name: '恢复适合宽度', exact: true }).click();
    await expect(region.locator('canvas')).toBeVisible();
    await expect.poll(() => region.evaluate(element => Math.abs(element.querySelector('canvas')!.getBoundingClientRect().width - Math.min(612, element.clientWidth - (innerWidth < 640 ? 32 : 80) - 2)))).toBeLessThan(1);
    const before = await paperPoint(region);
    await zoom(region, '放大');
    await expectPoint(region, before);
    await zoom(region, '放大');
    await expectPoint(region, before);
    await info.attach(`fit-transition-${size.width}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});


test('a pinch after two-axis scrolling preserves the paper point under its midpoint', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto('/'); await importBook(page);
  const region = reader(page);
  for (let i = 0; i < 5; i++) await zoom(region, '放大');
  await region.evaluate(element => element.scrollTo(250, 450));
  const before = await paperPoint(region, 0.4, 0.45);
  await region.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + element.clientWidth * 0.4, y = bounds.top + element.clientHeight * 0.45;
    const start = [{ identifier: 1, target: element, clientX: x - 40, clientY: y }, { identifier: 2, target: element, clientX: x + 40, clientY: y }];
    const end = [{ ...start[0], clientX: x - 52 }, { ...start[1], clientX: x + 52 }];
    for (const [type, touches] of [['touchstart', start], ['touchmove', end], ['touchend', []]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: end } });
      element.dispatchEvent(event);
    }
  });
  await expect.poll(async () => Math.abs((await paperPoint(region)).width - before.width * 1.3)).toBeLessThan(2);
  await expectPoint(region, before, 0.4, 0.45);
});
