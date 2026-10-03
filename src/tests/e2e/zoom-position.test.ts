import { test, expect, importBook, reader, reopenRecent, snapshots } from './helpers';
import type { Locator } from '@playwright/test';

async function paperPoint(region: Locator, x = 0.5, y = 0.5) {
  return region.evaluate((element, point) => {
    const bounds = element.getBoundingClientRect();
    const paper = element.querySelector('canvas')!.getBoundingClientRect();
    return { x: (bounds.left + element.clientWidth * point.x - paper.left) / paper.width,
      y: (bounds.top + element.clientHeight * point.y - paper.top) / paper.height,
      width: paper.width, left: element.scrollLeft, top: element.scrollTop };
  }, { x, y });
}
async function expectPoint(region: Locator, before: {x: number; y: number}, x = 0.5, y = 0.5) {
  await expect(region.locator('canvas')).toBeVisible();
  await expect.poll(async () => {
    const after = await paperPoint(region, x, y);
    return Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
  }, { message: 'The same paper point stays at the zoom anchor' }).toBeLessThan(0.006);
}
async function zoom(region: Locator, name: '放大' | '缩小') {
  await region.locator('..').getByRole('button', { name, exact: true }).click();
  await expect(region.locator('canvas')).toBeVisible();
}

test('toolbar zoom preserves the visible paper center after scrolling and reload, in both panes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto('/'); await importBook(page);
  await page.getByRole('button', { name: /^(夹住此页|已夹住此页)$/ }).click();
  await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
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
  await expectPoint(region, before, 0.4, 0.45);
  await expect.poll(async () => (await paperPoint(region)).width).toBeGreaterThan(before.width * 1.45);
});
