import { test, expect, importBook, reader, quickFlip, snapshots, reopenRecent, expectQuickFlipThumbnail } from './helpers';
import type { Page, TestInfo } from '@playwright/test';

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${testInfo.project.name}-${name}`, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

async function expectNoDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function showHeldPages(page: Page) {
  const toggle = page.getByRole('button', { name: /^夹页 \d+$/ });
  if (await toggle.isVisible()) await toggle.click();
}

test('welcome and reader remain usable at the project viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'welcome');
  await importBook(page);
  await expect(reader(page)).toBeVisible();
  await expect.poll(async () => reader(page).evaluate((region) => {
    const canvas = region.querySelector('canvas');
    return !!canvas && canvas.getBoundingClientRect().width <= region.getBoundingClientRect().width;
  }), { message: 'Default PDF width fits its reader pane' }).toBe(true);
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('header')).toContainText('第 2 页');
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'reader');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('slider', { name: '跳转到页码' })).toBeFocused();
  await page.keyboard.press('Tab');
  const nextPage = page.getByRole('button', { name: '下一页', exact: true });
  await expect(nextPage).toBeFocused();
  await expect.poll(() => nextPage.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
  await capture(page, testInfo, 'keyboard-focus');

  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect(quickFlip(page)).toBeVisible();
  await expect(quickFlip(page).getByRole('button', { name: '关闭速翻', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await expectQuickFlipThumbnail(page, 2);
  await capture(page, testInfo, 'quick-flip');
  await quickFlip(page).getByRole('button', { name: '预览下一页', exact: true }).click();
  await quickFlip(page).getByRole('button', { name: '阅读此页', exact: true }).click();
  await expect(quickFlip(page)).toHaveCount(0);
  await expect(page.locator('header')).toContainText('第 3 页');

  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await showHeldPages(page);
  await expect(page.getByRole('button', { name: '打开第 3 页参考窗口', exact: true })).toBeInViewport();
  await capture(page, testInfo, 'held-pages');
  await page.getByRole('button', { name: '打开第 3 页参考窗口', exact: true }).click();
  const reference = page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true });
  await expect(reference.locator('canvas')).toBeVisible();
  await expect.poll(() => reference.evaluate((region) => {
    const canvas = region.querySelector('canvas');
    return !!canvas && canvas.getBoundingClientRect().width <= region.getBoundingClientRect().width;
  }), { message: 'Default PDF width fits its reference pane' }).toBe(true);
  await expect(page.locator('[data-floating-window]').getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'comparison');
  await page.locator('[data-floating-window]').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('[data-floating-window]')).toHaveCount(0);
});

test('autosave and recent restore work without the desktop Save button', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await expect.poll(async () => (await snapshots(page)).some((snapshot) => snapshot.currentPage === 2 && snapshot.heldPages.length === 1)).toBe(true);
  await reopenRecent(page);
  await expect(page.locator('header')).toContainText('第 2 页');
  await showHeldPages(page);
  await expect(page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true })).toBeVisible();
});

test('import errors are visible, dismissible, and leave a usable import control', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新导入', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'invalid-pdf');
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
});

test('Escape dismisses a compact held-page drawer before its comparison', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await showHeldPages(page);
  await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  const drawerToggle = page.getByRole('button', { name: /^夹页 \d+$/ });
  if (await drawerToggle.isVisible()) {
    await drawerToggle.click();
    await expect(page.getByRole('button', { name: '← 返回阅读', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(drawerToggle).toBeFocused();
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-floating-window]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reader(page)).toBeVisible();
  await expect(reader(page)).toBeFocused();
});


test('fit-width is a starting scale and still allows intentional zoom overflow', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  const canvasWidth = () => reader(page).locator('canvas').evaluate((canvas) => canvas.getBoundingClientRect().width);
  const readerWidth = await reader(page).evaluate((region) => region.getBoundingClientRect().width);
  await expect.poll(canvasWidth).toBeLessThanOrEqual(readerWidth);
  const initialWidth = await canvasWidth();
  for (let index = 0; index < 7; index++) await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(canvasWidth).toBeGreaterThan(initialWidth);
  await expect.poll(canvasWidth).toBeGreaterThan(readerWidth);
  await expectNoDocumentOverflow(page);
});

test('compact 320px header keeps import and save controls reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeInViewport();
  await importBook(page);
  await expect(page.getByRole('button', { name: '保存现场', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'compact-header');
});

test('short landscape Quick Flip retains its preview and all primary actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await importBook(page);
  await page.getByRole('button', { name: /^速翻/ }).click();
  await expectQuickFlipThumbnail(page, 1);
  const dialog = quickFlip(page);
  for (const label of ['关闭速翻', '阅读此页', '夹住此页', '打开参考窗']) {
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeInViewport();
  }
  await expect(dialog.getByRole('button', { name: '选择第 1 页', exact: true }).locator('img')).toBeInViewport({ ratio: 0.95 });
  await capture(page, testInfo, 'short-landscape-quick-flip');
});
