import { test, expect, importBook, reader, snapshots, reopenRecent, quickFlip, expectMainPage } from './helpers';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const longBook = fileURLToPath(new URL('../fixtures/leafspace-120-pages.pdf', import.meta.url));
async function jump(page: Page, number: number | string) {
  const input = page.getByRole('textbox', { name: '输入页码' });
  await input.fill(String(number));
  await input.press('Enter');
}
async function openReference(page: Page, number: number) {
  await reader(page).focus();
  await jump(page, number);
  await page.getByRole('button', { name: /^(夹住此页|已夹住此页)$/ }).click();
  await page.getByRole('button', { name: `打开第 ${number} 页参考窗口`, exact: true }).click();
  await expect(page.getByRole('region', { name: `参考阅读区，第 ${number} 页`, exact: true }).locator('canvas')).toBeVisible();
}
async function offsets(region: Locator) {
  return region.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await importBook(page, longBook); });

test('TOC, numeric jump, hold, timeline and Quick Flip honor the focused reference', async ({ page }) => {
  await openReference(page, 8);
  await reader(page).focus();
  await jump(page, 2);
  const ref = page.getByRole('region', { name: '参考阅读区，第 8 页', exact: true });
  await ref.focus();
  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect(quickFlip(page).getByRole('button', { name: '选择第 8 页', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await quickFlip(page).getByRole('button', { name: '预览下一页', exact: true }).click();
  await quickFlip(page).getByRole('button', { name: '阅读此页', exact: true }).click();
  await expect(page.getByRole('region', { name: '参考阅读区，第 9 页', exact: true })).toBeVisible();
  await expectMainPage(page, 2);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await expect(page.getByRole('button', { name: '阅读第 9 页', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '目录', exact: true }).selectOption('120');
  await expect(page.getByRole('region', { name: '参考阅读区，第 120 页', exact: true }).locator('canvas')).toBeVisible();
  await page.getByRole('combobox', { name: '目录', exact: true }).selectOption('8');
  await expect(page.getByRole('region', { name: '参考阅读区，第 8 页', exact: true })).toBeVisible();
  await jump(page, 17);
  await expect(page.getByRole('region', { name: '参考阅读区，第 17 页', exact: true }).locator('canvas')).toBeVisible();
  const timeline = page.getByRole('slider', { name: '跳转到页码' });
  await timeline.focus(); await timeline.press('ArrowRight');
  await expect(page.getByRole('region', { name: '参考阅读区，第 18 页', exact: true })).toBeVisible();
  await expectMainPage(page, 2);
});

test('numeric input handles bounds, decimals, empty text and Escape without closing a reference', async ({ page }) => {
  await jump(page, 999); await expectMainPage(page, 120);
  await jump(page, 0); await expectMainPage(page, 1);
  await jump(page, '7.6'); await expectMainPage(page, 8);
  await jump(page, ''); await expectMainPage(page, 8);
  await jump(page, 'oops'); await expectMainPage(page, 8);
  await openReference(page, 12);
  const input = page.getByRole('textbox', { name: '输入页码' });
  await input.fill('35'); await input.press('Escape');
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  await expect(input).toHaveValue('12');
});

test('five-page grid keeps every pane visible after repeated docking, floating and reload', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  for (const number of [2, 4, 6, 8]) {
    await openReference(page, number);
    await page.locator('[data-floating-window]').last().getByRole('button', { name: '吸附', exact: true }).click();
  }
  await expect(page.locator('[data-reader-pane]')).toHaveCount(5);
  for (const number of [2, 4, 6, 8]) await expect(page.getByRole('region', { name: `参考阅读区，第 ${number} 页`, exact: true }).locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true }).click();
  await expect(page.getByText('最多同时打开 5 个阅读窗口。请先关闭一个参考窗口，再打开新页。')).toBeVisible();
  await expect(page.locator('[data-reader-pane]')).toHaveCount(5);
  await page.getByRole('button', { name: '关闭操作提示' }).click();
  await page.getByRole('combobox', { name: '工作区布局' }).selectOption('floating');
  await expect(page.locator('[data-floating-window]')).toHaveCount(4);
  await page.getByRole('combobox', { name: '工作区布局' }).selectOption('grid');
  await expect(page.locator('[data-floating-window]')).toHaveCount(0);
  await expect(reader(page).locator('canvas')).toBeVisible();
  for (const number of [2, 4, 6, 8]) await expect(page.getByRole('region', { name: `参考阅读区，第 ${number} 页`, exact: true }).locator('canvas')).toBeVisible();
  await testInfo.attach('five-page-grid', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect.poll(async () => (await snapshots(page))[0]?.windows.length).toBe(5);
  await reopenRecent(page, 'leafspace-120-pages.pdf');
  await expect(page.locator('[data-reader-pane]')).toHaveCount(5);
  for (const number of [2, 4, 6, 8]) await expect(page.getByRole('region', { name: `参考阅读区，第 ${number} 页`, exact: true }).locator('canvas')).toBeVisible();
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
  expect(violations).toEqual([]);
});

test('held-page order, limit and explicit reference-removal choices are durable', async ({ page }) => {
  for (let number = 1; number <= 12; number++) {
    await jump(page, number);
    await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  }
  await jump(page, 13);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await expect(page.getByText('最多夹住 12 页。请先移除一张夹页，再保留新页。')).toBeVisible();
  await expect(page.getByRole('button', { name: /^阅读第 \d+ 页$/ })).toHaveCount(12);
  await page.getByRole('button', { name: '上移第 2 页夹页', exact: true }).click();
  await expect(page.getByRole('button', { name: /^阅读第 \d+ 页$/ }).first()).toHaveAccessibleName('阅读第 2 页');
  await page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true }).click();
  await page.getByRole('button', { name: '移除第 2 页夹页', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '阅读第 2 页', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除第 2 页夹页', exact: true }).click();
  await page.getByRole('button', { name: '保留窗口', exact: true }).click();
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '阅读第 2 页', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '上移第 3 页夹页', exact: true }).click();
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect.poll(async () => (await snapshots(page))[0]?.heldPages[0]?.pageNumber).toBe(3);
  await reopenRecent(page, 'leafspace-120-pages.pdf');
  await expect(page.getByRole('button', { name: /^阅读第 \d+ 页$/ }).first()).toHaveAccessibleName('阅读第 3 页');
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
});

test('actual main and reference zoom and scroll restore after canvas rendering', async ({ page }, testInfo) => {
  await openReference(page, 8);
  await page.getByRole('combobox', { name: '工作区布局' }).selectOption('split');
  const mainPane = page.locator('[data-window-id="main"]');
  const refPane = page.locator('.workspace-docked');
  for (let i = 0; i < 5; i++) await mainPane.getByRole('button', { name: '放大', exact: true }).click();
  for (let i = 0; i < 6; i++) await refPane.getByRole('button', { name: '放大', exact: true }).click();
  const ref = page.getByRole('region', { name: '参考阅读区，第 8 页', exact: true });
  for (const region of [reader(page), ref]) {
    await expect.poll(() => region.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(120);
    await expect.poll(() => region.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(320);
    await region.evaluate(el => el.scrollTo(120, 320));
  }
  await expect.poll(async () => (await snapshots(page))[0]?.windows.every(win => (win.viewport?.scrollTop ?? 0) >= 319)).toBe(true);
  await testInfo.attach('zoomed-scroll-before-reload', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.locator('header')).toContainText('已保存到本机');
  await reopenRecent(page, 'leafspace-120-pages.pdf');
  for (const region of [reader(page), ref]) {
    await expect(region.locator('canvas')).toBeVisible();
    await expect.poll(async () => Math.abs((await offsets(region)).left - 120)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await offsets(region)).top - 320)).toBeLessThanOrEqual(1);
  }
  await testInfo.attach('zoomed-scroll-restored', { body: await page.screenshot(), contentType: 'image/png' });
});

test('fit-width reset works twice and continues saving scroll at 100%', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await reader(page).evaluate(el => el.scrollTo(0, 100));
  await page.getByRole('button', { name: '恢复适合宽度', exact: true }).click();
  await expect.poll(() => offsets(reader(page))).toEqual({ left: 0, top: 0 });
  await reader(page).evaluate(el => el.scrollTo(0, 120));
  await expect.poll(async () => Math.abs(((await snapshots(page))[0]?.windows[0]?.viewport?.scrollTop ?? -999) - 120)).toBeLessThanOrEqual(1);
  await reopenRecent(page, 'leafspace-120-pages.pdf');
  await expect.poll(async () => Math.abs((await offsets(reader(page))).top - 120)).toBeLessThanOrEqual(1);
  await expect.poll(async () => Math.abs((await offsets(reader(page))).left)).toBeLessThanOrEqual(1);
});

test('Ctrl-wheel zoom keeps the same paper point under the pointer', async ({ page }) => {
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '放大', exact: true }).click();
  const region = reader(page), canvas = region.locator('canvas');
  await expect.poll(() => region.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(120);
  await region.evaluate(el => el.scrollTo(100, 200));
  const bounds = await region.boundingBox(); if (!bounds) throw new Error('Reader missing');
  const point = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
  const logical = () => canvas.evaluate((el, point) => { const rect = el.getBoundingClientRect(); return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height, width: rect.width }; }, point);
  const before = await logical();
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await expect.poll(async () => (await logical()).width).toBeGreaterThan(before.width);
  await expect.poll(async () => Math.abs((await logical()).x - before.x)).toBeLessThan(0.03);
  await expect.poll(async () => Math.abs((await logical()).y - before.y)).toBeLessThan(0.03);
});
