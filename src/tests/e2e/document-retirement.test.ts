import { test, expect, BOOK_NAME, importBook, navigateTo, expectMainPage, reader } from './helpers';

for (const fallback of [false, true]) {
  test(`returning to the library retires ${fallback ? 'fallback PDF' : 'thumbnail'} workers and reopens the saved context`, async ({ page }, info) => {
    await page.addInitScript(({ fallback }) => {
      const NativeWorker = window.Worker;
      const records: { id: number; thumbnail: boolean; terminated: boolean }[] = [];
      Object.assign(window, { leafspaceWorkerLifecycle: records });
      window.Worker = class extends NativeWorker {
        private record: typeof records[number];
        constructor(url: string | URL, options?: WorkerOptions) {
          const thumbnail = String(url).includes('thumbnail.worker');
          if (fallback && thumbnail) throw new Error('Synthetic custom-worker unavailable');
          super(url, options);
          this.record = { id: records.length, thumbnail, terminated: false };
          records.push(this.record);
        }
        terminate() { this.record.terminated = true; super.terminate(); }
      };
    }, { fallback });
    await page.goto('/'); await importBook(page); await navigateTo(page, 7);
    await page.getByRole('button', { name: '夹住此页', exact: true }).click();
    const thumbnail = page.getByRole('button', { name: '阅读第 7 页', exact: true }).locator('img');
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole('button', { name: '回到书库', exact: true }).click();
      await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as {
        leafspaceWorkerLifecycle: { terminated: boolean }[];
      }).leafspaceWorkerLifecycle.filter(worker => !worker.terminated).length)).toBe(0);
      await page.getByRole('button', { name: new RegExp(BOOK_NAME) }).click();
      await expectMainPage(page, 7);
      await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
      await expect(thumbnail).toBeVisible();
      await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(reader(page).locator('canvas')).toBeVisible();
    }
    await page.getByRole('button', { name: '回到书库', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as {
      leafspaceWorkerLifecycle: { terminated: boolean }[];
    }).leafspaceWorkerLifecycle.every(worker => worker.terminated))).toBe(true);
    const records = await page.evaluate(() => (window as unknown as {
      leafspaceWorkerLifecycle: { thumbnail: boolean; terminated: boolean }[];
    }).leafspaceWorkerLifecycle);
    expect(records.length).toBeGreaterThanOrEqual(4);
    expect(records.filter(worker => worker.thumbnail).length).toBe(fallback ? 0 : 4);
    await info.attach('document-worker-retirement', { body: JSON.stringify({ fallback, records }), contentType: 'application/json' });
    await info.attach('saved-library-after-retirement', { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('closing during thumbnail initialization does not restart old work after its timeout', async ({ page }, info) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const state = { created: 0, terminated: 0, parkedRequests: 0, pdfWorkers: 0 };
    Object.assign(window, { leafspaceParkedThumbnail: state });
    window.Worker = class extends NativeWorker {
      private thumbnail: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.thumbnail = String(url).includes('thumbnail.worker');
        if (this.thumbnail) state.created++; else state.pdfWorkers++;
      }
      postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
        if (this.thumbnail) { state.parkedRequests++; return; }
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
      terminate() { if (this.thumbnail) state.terminated++; super.terminate(); }
    };
  });
  await page.goto('/'); await importBook(page);
  const state = () => page.evaluate(() => (window as unknown as {
    leafspaceParkedThumbnail: { created: number; terminated: number; parkedRequests: number; pdfWorkers: number };
  }).leafspaceParkedThumbnail);
  const imported = await state();
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await expect.poll(async () => (await state()).parkedRequests).toBeGreaterThan(0);
  const before = await state();
  expect(before).toMatchObject({ created: 1, terminated: 0, pdfWorkers: imported.pdfWorkers });
  await page.getByRole('button', { name: '回到书库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
  await expect.poll(async () => (await state()).terminated).toBe(before.created);
  // This deliberately outlasts the service's 1800 ms worker timeout. An old
  // timeout/catch must not activate fallback parsing after the library opens.
  await page.waitForTimeout(2000);
  expect(await state()).toEqual({ ...before, terminated: before.created });
  await info.attach('retired-thumbnail-timeout', { body: JSON.stringify(await state()), contentType: 'application/json' });
});
