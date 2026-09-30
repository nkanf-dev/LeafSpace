import { test, expect, importBook, reader, expectMainPage, navigateTo, holdCurrentPage, snapshots, reopenRecent, BOOK_PATH, OTHER_BOOK_PATH } from './helpers';

test.beforeEach(async ({ page }) => { await page.goto('/'); await importBook(page); });

test('manual save restores page, scale, held pages, and a docked comparison after reload', async ({ page }) => {
  await navigateTo(page, 4);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await holdCurrentPage(page, 4);
  await page.getByRole('button', { name: '打开第 4 页参考窗口', exact: true }).click();
  await page.locator('[data-floating-window]').getByRole('button', { name: '吸附', exact: true }).click();
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect.poll(async () => (await snapshots(page)).some((snapshot) => snapshot.currentPage === 4 && snapshot.scale === 1.2 && snapshot.heldPages.length === 1 && snapshot.windows.some((window) => window.dockMode === 'right-half'))).toBe(true);

  await reopenRecent(page);
  await expectMainPage(page, 4);
  await expect(page.getByText('120%', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开第 4 页参考窗口', exact: true })).toBeVisible();
  await expect(page.getByRole('separator', { name: '调整主窗口与分栏宽度' })).toBeVisible();
  await expect(page.getByRole('region', { name: '参考阅读区，第 4 页', exact: true }).locator('canvas')).toBeVisible();
});

test('debounced autosave is durable and stops writing when the workspace is idle', async ({ page }) => {
  await navigateTo(page, 6);
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(6);
  // Three debounce periods deliberately verify the regression: saving -> idle must
  // not trigger another write without a real workspace edit.
  const savedAt = (await snapshots(page))[0].savedAt;
  await page.waitForTimeout(1_500);
  expect((await snapshots(page))[0].savedAt).toBe(savedAt);
  await reopenRecent(page);
  await expectMainPage(page, 6);
  await reader(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(7);
  expect((await snapshots(page))[0].savedAt).not.toBe(savedAt);
});

test('two different PDFs retain isolated reading positions and references', async ({ page }) => {
  await navigateTo(page, 5);
  await holdCurrentPage(page, 5);
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect.poll(async () => (await snapshots(page)).some((snapshot) => snapshot.currentPage === 5 && snapshot.heldPages.length === 1)).toBe(true);

  await importBook(page, OTHER_BOOK_PATH);
  await expectMainPage(page, 1);
  await expect(page.getByRole('slider', { name: '跳转到页码' })).toHaveAttribute('max', '4');
  await expect(page.getByRole('button', { name: '打开第 5 页参考窗口', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-floating-window]')).toHaveCount(0);
  await navigateTo(page, 3);
  await expect.poll(async () => (await snapshots(page)).some((snapshot) => snapshot.currentPage === 3 && snapshot.heldPages.length === 0)).toBe(true);

  await importBook(page, BOOK_PATH);
  await expectMainPage(page, 5);
  await expect(page.getByRole('button', { name: '打开第 5 页参考窗口', exact: true })).toBeVisible();
  await reopenRecent(page, 'leafspace-other-book.pdf');
  await expectMainPage(page, 3);
});

test('a failed replacement import leaves the previous book recoverable', async ({ page }) => {
  await navigateTo(page, 7);
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(7);
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnot a real document') });
  await expect(page.getByRole('alert')).toBeVisible();
  await importBook(page, BOOK_PATH);
  await expectMainPage(page, 7);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('returning to the library flushes the latest change before the debounce timer', async ({ page }) => {
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('button', { name: '回到书库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
  await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
  await expectMainPage(page, 2);
});

test('switching documents immediately preserves the outgoing reading position', async ({ page }) => {
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await importBook(page, OTHER_BOOK_PATH);
  await expectMainPage(page, 1);
  await importBook(page, BOOK_PATH);
  await expectMainPage(page, 2);
});
