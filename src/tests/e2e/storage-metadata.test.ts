import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, BOOK_PATH, BOOK_NAME, importBook, navigateTo, snapshots, expectMainPage, reader } from './helpers';

async function seedLegacyBook(page: Page, format: 'bytes' | 'blob') {
  await page.goto('/'); await importBook(page); await navigateTo(page, 7);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await page.getByRole('button', { name: '回到书库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
  const snapshot = (await snapshots(page))[0];
  const bytes = Array.from(await readFile(BOOK_PATH));
  // Only this test's isolated synthetic database is recreated in the actual v1
  // schema. The subsequent reload executes the application's real upgrade path.
  await page.evaluate(async ({ snapshot, bytes, format, name }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('leafspace');
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Synthetic database remained open'));
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('leafspace', 10); // Dexie version 1 uses native version 10.
      request.onupgradeneeded = () => {
        const books = request.result.createObjectStore('books', { keyPath: 'documentId' });
        books.createIndex('lastOpenedAt', 'lastOpenedAt'); books.createIndex('lastSavedAt', 'lastSavedAt');
        const workspaces = request.result.createObjectStore('workspaces', { keyPath: 'documentId' });
        workspaces.createIndex('savedAt', 'savedAt');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['books', 'workspaces'], 'readwrite');
        const data = new Uint8Array(bytes);
        transaction.objectStore('books').put({ documentId: snapshot.documentId, fileName: name,
          fileSize: bytes.length, totalPages: 12, lastOpenedAt: snapshot.savedAt, lastSavedAt: snapshot.savedAt,
          ...(format === 'bytes' ? { bytes: data.buffer } : { blob: new Blob([data], { type: 'application/pdf' }) }),
        });
        transaction.objectStore('workspaces').put(snapshot);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, { snapshot, bytes, format, name: BOOK_NAME });
  return { snapshot, size: bytes.length };
}

async function installStorageProbe(page: Page, failure?: 'schema' | 'metadata') {
  await page.addInitScript(({ failure }) => {
    const state = { failure, enabled: true, assetReads: 0, assetWrites: 0 };
    Object.assign(window, { leafspaceMetadataProbe: state });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'books') state.assetWrites++;
      if (state.enabled && state.failure === 'metadata' && this.name === 'bookMetadata') throw new DOMException('Synthetic metadata quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    };
    for (const method of ['get', 'getAll', 'openCursor'] as const) {
      const original = IDBObjectStore.prototype[method];
      Object.defineProperty(IDBObjectStore.prototype, method, { configurable: true, writable: true, value: function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === 'books') state.assetReads++;
        return Reflect.apply(original, this, args);
      } });
    }
    for (const method of ['get', 'getAll', 'openCursor'] as const) {
      const original = IDBIndex.prototype[method];
      Object.defineProperty(IDBIndex.prototype, method, { configurable: true, writable: true, value: function (this: IDBIndex, ...args: unknown[]) {
        if (this.objectStore.name === 'books') state.assetReads++;
        return Reflect.apply(original, this, args);
      } });
    }
    const create = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = function (name, options) {
      if (state.enabled && state.failure === 'schema' && name === 'bookMetadata') throw new DOMException('Synthetic schema quota exceeded', 'QuotaExceededError');
      return create.call(this, name, options);
    };
  }, { failure });
}

async function probe(page: Page) {
  return page.evaluate(() => (window as unknown as { leafspaceMetadataProbe: { assetReads: number; assetWrites: number } }).leafspaceMetadataProbe);
}

for (const format of ['bytes', 'blob'] as const) {
  test(`upgrades the legacy ${format} library without rewriting its PDF and keeps warm saves lightweight`, async ({ page }, info) => {
    const before = await seedLegacyBook(page, format);
    await installStorageProbe(page); await page.reload();
    await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
    await expectMainPage(page, 7);
    await expect(page.getByRole('button', { name: '阅读第 7 页', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
    expect((await probe(page)).assetWrites).toBe(0);
    await page.evaluate(() => { (window as unknown as { leafspaceMetadataProbe: { assetReads: number } }).leafspaceMetadataProbe.assetReads = 0; });
    await navigateTo(page, 8);
    await page.getByRole('button', { name: '保存现场', exact: true }).click();
    await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '回到书库', exact: true }).click();
    await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
    expect(await probe(page)).toMatchObject({ assetReads: 0, assetWrites: 0 });
    const retained = await page.evaluate(({ documentId, format }) => new Promise<{ version: number; size: number; originalFormat: boolean }>((resolve, reject) => {
      const request = indexedDB.open('leafspace'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('books', 'readonly');
        const read = transaction.objectStore('books').get(documentId);
        read.onsuccess = () => resolve({ version: db.version, size: read.result.bytes?.byteLength ?? read.result.blob?.size,
          originalFormat: format === 'bytes' ? read.result.bytes instanceof ArrayBuffer : read.result.blob instanceof Blob && !read.result.bytes });
        read.onerror = () => reject(read.error); transaction.oncomplete = () => db.close();
      };
    }), { documentId: before.snapshot.documentId, format });
    expect(retained).toEqual({ version: 20, size: before.size, originalFormat: true });
    await info.attach(`legacy-${format}-lightweight-save`, { body: JSON.stringify({ retained, warmAssetReads: 0, assetWrites: 0 }), contentType: 'application/json' });
  });
}

for (const failure of ['schema', 'metadata'] as const) {
  test(`an intact legacy PDF remains readable during ${failure} failure and saving recovers after retry`, async ({ page }, info) => {
    await seedLegacyBook(page, 'bytes');
    await installStorageProbe(page, failure); await page.reload();
    await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
    await expectMainPage(page, 7);
    await expect(reader(page).locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: '保存现场', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await probe(page)).assetWrites).toBe(0);
    await info.attach(`${failure}-failure-readable`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => { (window as unknown as { leafspaceMetadataProbe: { enabled: boolean } }).leafspaceMetadataProbe.enabled = false; });
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '回到书库', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
    await expectMainPage(page, 7);
    expect((await probe(page)).assetWrites).toBe(0);
  });
}

test('a blocked version upgrade explains the other-tab action and can retry without losing the old book', async ({ page }) => {
  await seedLegacyBook(page, 'bytes');
  const blocker = await page.context().newPage();
  await blocker.route('**/__metadata_blocker__', route => route.fulfill({ contentType: 'text/html', body: '<title>Synthetic storage blocker</title>' }));
  await blocker.goto('/__metadata_blocker__');
  await blocker.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('leafspace'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { Object.assign(window, { syntheticStorageBlocker: request.result }); resolve(); };
  }));
  await page.bringToFront(); await page.reload();
  await expect(page.getByRole('alert')).toContainText('其他页境标签页');
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
  await blocker.evaluate(() => { (window as unknown as { syntheticStorageBlocker: IDBDatabase }).syntheticStorageBlocker.close(); });
  await blocker.close(); await page.bringToFront();
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).find(database => database.name === 'leafspace')?.version)).toBe(20);
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
  await expectMainPage(page, 7);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
