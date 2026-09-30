import { test, expect, importBook, reader, quickFlip, snapshots, reopenRecent } from './helpers';
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
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('header')).toContainText('第 2 页');
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'reader');
  await page.getByRole('button', { name: '下一页', exact: true }).focus();
  await capture(page, testInfo, 'keyboard-focus');

  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect(quickFlip(page)).toBeVisible();
  await expect(quickFlip(page).getByRole('button', { name: '关闭速翻', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
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
  await expect(page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
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
