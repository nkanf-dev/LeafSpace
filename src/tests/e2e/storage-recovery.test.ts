import { test, expect, importBook, reader, navigateTo, snapshots, reopenRecent, BOOK_NAME, OTHER_BOOK_PATH, expectMainPage } from './helpers';
import type { Page } from '@playwright/test';

// Fail only synthetic-book IndexedDB operations in this isolated browser context.
// The real application import, PDF renderer, persistence service and controls run.
async function installStorageFault(page: Page, fault: 'asset' | 'restore') {
  await page.addInitScript(({ fault }) => {
    const state = { enabled: true };
    Object.assign(window, { leafspaceStorageFault: state });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (state.enabled && fault === 'asset' && this.name === 'books') throw new DOMException('Synthetic PDF quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    };
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      if (state.enabled && fault === 'restore' && this.name === 'workspaces') throw new DOMException('Synthetic snapshot read unavailable', 'UnknownError');
      return get.apply(this, args);
    };
  }, { fault });
}

async function recoverStorage(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { leafspaceStorageFault: { enabled: boolean } }).leafspaceStorageFault.enabled = false;
  });
}

test('PDF quota failure stays visible across save and leave attempts, then recovers the original file', async ({ page }, testInfo) => {
  await installStorageFault(page, 'asset');
  await page.goto('/');
  await importBook(page);
  await expect(page.getByRole('alert')).toContainText('PDF 尚未保存到本机');
  await testInfo.attach('pdf-quota-initial-guidance', { body: await page.screenshot(), contentType: 'image/png' });
  await navigateTo(page, 9);
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PDF 尚未保存到本机');
  await expect(page.getByText('已保存到本机', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '回到书库' }).click();
  await expectMainPage(page, 9);
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(OTHER_BOOK_PATH);
  await expect(page.getByRole('alert')).toContainText('已暂停切换书籍');
  await expectMainPage(page, 9);
  expect(await snapshots(page)).toEqual([]);
  await testInfo.attach('pdf-copy-save-recovery', { body: await page.screenshot(), contentType: 'image/png' });
  await recoverStorage(page);
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(9);
  await page.getByRole('button', { name: '回到书库' }).click();
  await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
  await expectMainPage(page, 9);
});

test('failed snapshot reads cannot be overwritten by leaving, importing, or cancelling a manual save', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  await navigateTo(page, 8);
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(8);
  await installStorageFault(page, 'restore');
  await reopenRecent(page);
  await expect(page.getByRole('alert')).toContainText('Synthetic snapshot read unavailable');
  await expectMainPage(page, 1);
  await page.getByRole('button', { name: '回到书库' }).click();
  await expect(reader(page)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('上次阅读现场尚未恢复');
  await page.locator('input[type="file"]').setInputFiles(OTHER_BOOK_PATH);
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  const cancel = page.getByRole('button', { name: '取消覆盖' });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: '确认替换上次现场' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存现场', exact: true })).toBeFocused();
  expect((await snapshots(page))[0].currentPage).toBe(8);
  await recoverStorage(page);
  await page.getByRole('button', { name: '重试恢复', exact: true }).click();
  await expectMainPage(page, 8);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('explicit replacement of an unread snapshot preserves the current reading context', async ({ page }, testInfo) => {
  await page.goto('/');
  await importBook(page);
  await navigateTo(page, 8);
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(8);
  await installStorageFault(page, 'restore');
  await reopenRecent(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await navigateTo(page, 3);
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByRole('group', { name: '确认替换上次现场' })).toContainText('当前页码、夹页和窗口布局');
  expect((await snapshots(page))[0].currentPage).toBe(8);
  await testInfo.attach('confirm-workspace-replacement', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: '覆盖上次现场', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(3);
  await recoverStorage(page);
  await page.getByRole('button', { name: '回到书库' }).click();
  await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
  await expectMainPage(page, 3);
});
