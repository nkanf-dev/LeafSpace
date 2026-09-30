/// <reference types="node" />
import { test as base, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { WorkspaceSnapshot } from '../../types/domain';

export const BOOK_NAME = 'leafspace-12-pages.pdf';
export const BOOK_PATH = fileURLToPath(new URL('../fixtures/leafspace-12-pages.pdf', import.meta.url));
export const OTHER_BOOK_PATH = fileURLToPath(new URL('../fixtures/leafspace-other-book.pdf', import.meta.url));

/** Catch regressions that leave the UI apparently usable after an uncaught exception. */
export const test = base.extend<{ checkRuntimeErrors: void }>({
  checkRuntimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use();
    expect(errors, 'No uncaught browser exceptions').toEqual([]);
  }, { auto: true }],
});
export { expect };

export const reader = (page: Page) => page.getByRole('region', { name: '主阅读区', exact: true });
export const quickFlip = (page: Page) => page.getByRole('dialog', { name: '速翻视图' });

export async function importBook(page: Page, filePath = BOOK_PATH) {
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(reader(page).locator('canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
}

export async function expectMainPage(page: Page, number: number) {
  await expect(page.locator('header')).toContainText(`第 ${number} 页`);
  await expect(reader(page).locator(`.react-pdf__Page[data-page-number="${number}"] canvas`)).toBeVisible();
}

export async function navigateTo(page: Page, number: number) {
  await reader(page).focus();
  // The semantic slider exposes absolute navigation without brittle screen coordinates.
  const timeline = page.getByRole('slider', { name: '跳转到页码' });
  await timeline.focus();
  await page.keyboard.press('Home');
  for (let index = 1; index < number; index++) await page.keyboard.press('ArrowRight');
  await expectMainPage(page, number);
  await reader(page).focus();
}

export async function openQuickFlip(page: Page) {
  await reader(page).focus();
  await page.keyboard.press('Space');
  await expect(quickFlip(page)).toBeVisible();
}

export async function holdCurrentPage(page: Page, number: number) {
  await reader(page).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: `打开第 ${number} 页参考窗口`, exact: true })).toBeVisible();
}

/** Read the real durable database; do not shortcut application interactions. */
export async function snapshots(page: Page): Promise<WorkspaceSnapshot[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === 'leafspace')) return [];
    return new Promise<WorkspaceSnapshot[]>((resolve, reject) => {
      const request = indexedDB.open('leafspace');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('workspaces')) {
          database.close();
          resolve([]);
          return;
        }
        const transaction = database.transaction('workspaces', 'readonly');
        const read = transaction.objectStore('workspaces').getAll();
        read.onsuccess = () => resolve(read.result as WorkspaceSnapshot[]);
        read.onerror = () => reject(read.error);
        transaction.oncomplete = () => database.close();
        transaction.onabort = () => database.close();
      };
    });
  });
}

export async function reopenRecent(page: Page, bookName = BOOK_NAME) {
  await page.reload();
  await page.getByRole('button', { name: new RegExp(bookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await expect(reader(page).locator('canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
}

/** Seed a storage fault only inside the isolated synthetic-book test context. */
export async function seedStorageFault(page: Page, storeName: 'books' | 'workspaces', documentId: string, value: Record<string, unknown> | null) {
  await page.evaluate(({ storeName, documentId, value }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('leafspace');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      if (value === null) store.delete(documentId);
      else store.put({ ...value, documentId });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), { storeName, documentId, value });
}

/** Wait for decoded PDF pixels, not a numbered placeholder or a fallback label. */
export async function expectQuickFlipThumbnail(page: Page, number: number) {
  const selected = quickFlip(page).getByRole('button', { name: `选择第 ${number} 页`, exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const image = selected.locator('img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0 && element.naturalHeight > 0), {
    message: `Selected page ${number} has a decoded PDF thumbnail`,
  }).toBe(true);
}
