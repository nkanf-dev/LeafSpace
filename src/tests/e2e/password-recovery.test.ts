import { fileURLToPath } from 'node:url';
import { test, expect, importBook, reader, navigateTo, expectMainPage, holdCurrentPage, snapshots } from './helpers';
import type { Page } from '@playwright/test';

const protectedBook = fileURLToPath(new URL('../fixtures/leafspace-password-required.pdf', import.meta.url));
const ownerOnlyBook = fileURLToPath(new URL('../fixtures/leafspace-owner-only.pdf', import.meta.url));

async function localBooks(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(database => database.name === 'leafspace')) return [];
    const assets = await new Promise<{ documentId: string; bytes: ArrayBuffer | Blob }[]>((resolve, reject) => {
      const request = indexedDB.open('leafspace');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('books')) { db.close(); resolve([]); return; }
        const transaction = db.transaction('books', 'readonly');
        const read = transaction.objectStore('books').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
        transaction.oncomplete = transaction.onabort = () => db.close();
      };
    });
    return Promise.all(assets.map(async asset => {
      const bytes = asset.bytes instanceof Blob ? await asset.bytes.arrayBuffer() : asset.bytes;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { documentId: asset.documentId, size: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
    }));
  });
}

test('opening-password guidance permits repeated attempts and importing a usable copy', async ({ page }, info) => {
  await page.goto('/');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('input[type="file"]').setInputFiles(protectedBook);
    await expect(page.getByRole('alert')).toContainText('这份 PDF 需要打开密码，页境暂不支持');
    await expect(page.getByRole('alert')).toContainText('本机另存一份无需打开密码');
    await expect(page.getByRole('alert')).not.toContainText('synthetic-reader');
    await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
    await expect(page.locator('input[type="file"]')).toHaveValue('');
    expect(await localBooks(page)).toEqual([]);
    expect(await snapshots(page)).toEqual([]);
  }
  await info.attach('opening-password-guidance', { body: await page.screenshot(), contentType: 'image/png' });
  await importBook(page);
  await expectMainPage(page, 1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('owner-permission encryption without an opening password remains readable', async ({ page }) => {
  await page.goto('/'); await importBook(page, ownerOnlyBook);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(reader(page).getByText('LeafSpace test book', { exact: true })).toBeAttached();
  await expect.poll(async () => (await localBooks(page)).length).toBe(1);
});

for (const kind of ['protected', 'corrupt'] as const) {
  test(`${kind} replacement keeps the local PDF and full reading context recoverable from recents`, async ({ page }, info) => {
    test.skip(info.project.name === 'mobile' || info.project.name === 'mobile-webkit' || info.project.name === 'tablet', 'Multi-pane context is checked on desktop; compact imports are covered separately.');
    await page.goto('/'); await importBook(page); await navigateTo(page, 6);
    await reader(page).locator('..').getByRole('button', { name: '放大', exact: true }).click();
    await holdCurrentPage(page, 6);
    await page.getByRole('button', { name: '打开第 6 页参考窗口', exact: true }).click();
    await page.locator('[data-floating-window]').getByRole('button', { name: '吸附', exact: true }).click();
    const reference = page.getByRole('region', { name: '参考阅读区，第 6 页', exact: true });
    for (let step = 0; step < 3; step++) await reference.locator('..').getByRole('button', { name: '放大', exact: true }).click();
    await expect(reference.locator('canvas')).toBeVisible();
    await reference.evaluate(element => element.scrollTo(30, 120));
    await reader(page).focus();
    await page.getByRole('button', { name: '保存现场', exact: true }).click();
    await expect.poll(async () => (await snapshots(page))[0]?.windows.find(window => window.canClose)?.viewport?.scrollTop).toBe(120);
    const before = (await snapshots(page))[0];
    const bytes = await localBooks(page);
    expect(bytes).toHaveLength(1);
    // No autosave wait after this last page change. The transition owns its flush.
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(kind === 'protected' ? protectedBook
      : { name: 'corrupt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnot a real document') });
    await expect(page.getByRole('alert')).toContainText(kind === 'protected' ? '需要打开密码' : '文件是否完整');
    if (kind === 'corrupt') await expect(page.getByRole('alert')).not.toContainText('需要打开密码');
    const saved = (await snapshots(page))[0];
    expect(saved.currentPage).toBe(7);
    expect(saved.scale).toBe(before.scale);
    expect(saved.heldPages).toEqual(before.heldPages.map(held => ({ ...held, linkedWindowIds: held.linkedWindowIds.filter(id => id !== 'main') })));
    expect(saved.windows.filter(window => window.canClose)).toEqual(before.windows.filter(window => window.canClose));
    expect(saved.activeWindowId).toBe('main');
    expect(await localBooks(page)).toEqual(bytes);
    expect(await snapshots(page)).toHaveLength(1);
    await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
    await expectMainPage(page, 7);
    await expect(reference.locator('canvas')).toBeVisible();
    await expect(reader(page).locator('..').getByText('120%', { exact: true })).toBeVisible();
    await expect(reference.locator('..').getByText('173%', { exact: true })).toBeVisible();
    await expect.poll(() => reference.evaluate(element => element.scrollTop)).toBe(120);
    await expect.poll(() => reference.evaluate(element => element.scrollLeft)).toBe(30);
    await expect(page.getByRole('button', { name: '打开第 6 页参考窗口', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await info.attach(`${kind}-replacement-recent-recovery`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
