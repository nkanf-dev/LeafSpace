import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, BOOK_PATH, BOOK_NAME, importBook, navigateTo, snapshots, expectMainPage, reader } from './helpers';

// Probe native storage independently of the app service. Linux WebKit can reject Blob
// storage itself, so it cannot manufacture a legacy Blob record for migration.
async function nativeBlobStorageCapability(page: Page) {
  await page.goto('/');
  const bytes = Array.from(await readFile(BOOK_PATH));
  return page.evaluate(async (bytes) => {
    const name = `leafspace-native-blob-probe-${crypto.randomUUID()}`;
    let db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('control');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Native probe open failed'));
    });
    let stage = 'write';
    const roundTrip = async (value: ArrayBuffer | Blob) => {
      stage = 'write';
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('control', 'readwrite');
        const request = transaction.objectStore('control').put(value, 'pdf');
        let requestError: DOMException | null = null;
        request.onerror = () => { requestError = request.error; };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(requestError ?? transaction.error ?? new Error('Native probe write aborted'));
      });
      db.close();
      stage = 'reopen';
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Native probe reopen failed'));
      });
      stage = 'read';
      return new Promise<ArrayBuffer | Blob>((resolve, reject) => {
        const transaction = db.transaction('control', 'readonly');
        const request = transaction.objectStore('control').get('pdf');
        let result: ArrayBuffer | Blob;
        let requestError: DOMException | null = null;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { requestError = request.error; };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(requestError ?? transaction.error ?? new Error('Native probe read aborted'));
      });
    };
    const matches = (buffer: ArrayBuffer) => {
      const actual = new Uint8Array(buffer);
      return actual.length === bytes.length && actual.every((value, index) => value === bytes[index]);
    };
    try {
      const control = await roundTrip(new Uint8Array(bytes).buffer);
      if (!(control instanceof ArrayBuffer) || !matches(control)) throw new Error('Native ArrayBuffer storage control failed');
      let stored: ArrayBuffer | Blob;
      try { stored = await roundTrip(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })); }
      catch (error) {
        return { bytesRoundTrip: true, blobRoundTrip: false, stage, errorName: error instanceof Error || error instanceof DOMException ? error.name : '',
          errorMessage: error instanceof Error || error instanceof DOMException ? error.message : String(error) };
      }
      if (!(stored instanceof Blob) || !matches(await stored.arrayBuffer())) throw new Error('Native Blob read-back differs from source');
      return { bytesRoundTrip: true, blobRoundTrip: true, stage: 'complete', errorName: '', errorMessage: '' };
    } finally {
      db.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Native probe cleanup failed'));
        request.onblocked = () => reject(new Error('Native probe cleanup blocked'));
      });
    }
  }, bytes);
}

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
        const write = transaction.objectStore('books').put({ documentId: snapshot.documentId, fileName: name,
          fileSize: bytes.length, totalPages: 12, lastOpenedAt: snapshot.savedAt, lastSavedAt: snapshot.savedAt,
          ...(format === 'bytes' ? { bytes: data.buffer } : { blob: new Blob([data], { type: 'application/pdf' }) }),
        });
        transaction.objectStore('workspaces').put(snapshot);
        let requestError: DOMException | null = null;
        write.onerror = () => { requestError = write.error; };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(requestError ?? transaction.error ?? new Error('Legacy seed transaction aborted')); };
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
  test(`upgrades the legacy ${format} library without rewriting its PDF and keeps warm saves lightweight`, async ({ page, browserName, browser }, info) => {
    if (format === 'blob') {
      const capability = await nativeBlobStorageCapability(page);
      await info.attach('native-blob-storage-capability', { body: JSON.stringify({ browserName, browserVersion: browser.version(), platform: process.platform, ...capability }), contentType: 'application/json' });
      const knownLinuxWebKitFailure = process.platform === 'linux' && browserName === 'webkit'
        && !capability.blobRoundTrip && capability.stage === 'write' && capability.errorName === 'UnknownError'
        && capability.errorMessage === 'Error preparing Blob/File data to be stored in object store';
      test.skip(knownLinuxWebKitFailure, 'Native Linux WebKit rejects Blob storage before the app can create a legacy record; ArrayBuffer control passed');
      expect(capability.blobRoundTrip, JSON.stringify(capability)).toBe(true);
    }
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

// A visible canvas alone does not establish that decoded page pixels are sound.
// This fixture has a green rectangle at PDF (40,100)-(215,300) on page seven.
async function fixturePixels(page: Page) {
  return reader(page).locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => Array.from(context.getImageData(
      Math.floor(canvas.width * x / 420), Math.floor(canvas.height * y / 594), 1, 1).data);
    return { width: canvas.width, height: canvas.height, visibility: getComputedStyle(canvas).visibility,
      background: pixel(10, 10), rectangle: pixel(80, 394), transform: Array.from(context.getTransform().toFloat64Array()) };
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
    await expect(reader(page).locator('canvas')).toBeVisible();
    const initialPixels = await fixturePixels(page);
    await info.attach(`${failure}-initial-decoded-pixels`, { body: JSON.stringify(initialPixels), contentType: 'application/json' });
    const bitmap = await reader(page).locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1]);
    await info.attach(`${failure}-decoded-bitmap`, { body: Buffer.from(bitmap, 'base64'), contentType: 'image/png' });
    // Check the next painted frames separately: a screenshot/compositor anomaly
    // must not be mistaken for an intact canvas or silently accepted as success.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const settledPixels = await fixturePixels(page);
    await info.attach(`${failure}-settled-decoded-pixels`, { body: JSON.stringify(settledPixels), contentType: 'application/json' });
    expect(settledPixels.background).toEqual([240, 237, 224, 255]);
    expect(settledPixels.rectangle).toEqual([51, 128, 76, 255]);
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
