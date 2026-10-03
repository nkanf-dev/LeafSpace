import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect, importBook, reader, quickFlip, snapshots } from './helpers';

const fixture = fileURLToPath(new URL('../fixtures/jpx-scan.pdf', import.meta.url));
const control = fileURLToPath(new URL('../fixtures/rgb-control.pdf', import.meta.url));
const sourceHash = createHash('sha256').update(readFileSync(fixture)).digest('hex');
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const version = JSON.parse(readFileSync(join(pdfjsRoot, 'package.json'), 'utf8')).version as string;
const expected = [[210, 40, 40, 255], [20, 130, 40, 255], [255, 255, 255, 255]];
function error(samples: number[][]) {
  if (samples.some(sample => sample[3] !== 255)) return 255;
  return Math.max(...samples.flatMap((sample, index) => sample.slice(0, 3).map((value, channel) => Math.abs(value - expected[index][channel]))));
}
async function canvasSamples(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => [0.25, 0.75, 0.5].map(y => Array.from(element.getContext('2d')!.getImageData(Math.floor(element.width / 2), Math.floor(element.height * y), 1, 1).data)));
}
async function expectDecoded(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await expect.poll(async () => error(await canvasSamples(canvas)), { message: 'Both colored regions of the JPEG2000 scan are decoded, not blank success' }).toBeLessThanOrEqual(2);
}
async function thumbnailSamples(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0);
    return [0.25, 0.75, 0.5].map(y => Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * y), 1, 1).data));
  });
}
async function expectThumbnail(image: Locator) {
  await expect.poll(async () => error(await thumbnailSamples(image)), { message: 'The lossy thumbnail retains both original scan colors' }).toBeLessThanOrEqual(24);
}
async function isolateDecoders(page: Page, fallback: boolean, blockWasm: boolean) {
  const requests: string[] = [];
  page.context().on('request', request => { if (request.url().includes('/wasm/')) requests.push(request.url()); });
  await page.context().route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL as string).origin || (blockWasm && url.pathname.endsWith('/openjpeg.wasm'))) await route.abort('failed');
    else await route.continue();
  });
  await page.addInitScript(({ fallback }) => {
    const NativeWorker = window.Worker;
    const evidence = { customCreated: 0, customSuccess: 0, customErrors: 0, errors: [] as { type: string; error?: string; key?: string; pageNumber?: number }[], fallback };
    Object.assign(window, { leafspaceDecoderEvidence: evidence });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const custom = String(url).includes('thumbnail.worker');
        if (custom && fallback) throw new Error('Synthetic custom-worker unavailable');
        super(url, options);
        if (custom) {
          evidence.customCreated++;
          this.addEventListener('message', event => {
            if (event.data?.type === 'success') evidence.customSuccess++;
            if (event.data?.type === 'error' || event.data?.type === 'document-error') { evidence.customErrors++; evidence.errors.push({ type: event.data.type, error: event.data.error, key: event.data.key, pageNumber: event.data.pageNumber }); }
          });
        }
      }
    };
  }, { fallback });
  return requests;
}
async function decoderResourceEvidence(page: Page, requests: string[]) {
  const workers = await Promise.all(page.workers().map(async worker => {
    try { return { url: worker.url(), resources: await worker.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.includes('/wasm/'))) }; }
    catch (error) { return { url: worker.url(), resources: [] as string[], retired: String(error) }; }
  }));
  // Firefox can omit dynamic worker imports from network events. Resource timing
  // remains browser evidence for the same required decoder and mounted prefix.
  return { requests, workers, observed: [...requests, ...workers.flatMap(worker => worker.resources)] };
}
function expectLocalDecoderRequests(page: Page, requests: string[]) {
  const directory = new URL(`pdfjs/${version}/wasm/`, page.url()).href;
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) expect(url.startsWith(directory), `Decoder request stays under the mounted app base: ${url}`).toBe(true);
}
async function durableHash(page: Page) {
  return page.evaluate(async () => {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const opening = indexedDB.open('leafspace'); opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, transaction = db.transaction('books', 'readonly'), request = transaction.objectStore('books').getAll();
        request.onsuccess = async () => { try { resolve(request.result[0].bytes ?? await request.result[0].blob.arrayBuffer()); } catch (error) { reject(error); } };
        request.onerror = () => reject(request.error); transaction.oncomplete = () => db.close(); transaction.onabort = () => db.close();
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

test('RGB control uses the same visible scan colors without a JPEG2000 decoder', async ({ page }) => {
  await page.goto('./'); await importBook(page, control); await expectDecoded(reader(page).locator('canvas'));
});

for (const blockWasm of [false, true]) {
  test(`JPEG2000 raster decodes in the main and reference reader with ${blockWasm ? 'local JavaScript fallback' : 'native WASM'}`, async ({ page }, info) => {
    const requests = await isolateDecoders(page, false, blockWasm);
    await page.goto('./'); await importBook(page, fixture); await expectDecoded(reader(page).locator('canvas'));
    await page.getByRole('button', { name: /^速翻/ }).click();
    await page.keyboard.press('n');
    const reference = page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true });
    await expectDecoded(reference.locator('canvas'));
    const resources = await decoderResourceEvidence(page, requests);
    await info.attach('reader-decoder-requests-before-assert', { body: JSON.stringify(resources, null, 2), contentType: 'application/json' });
    expect(requests.some(url => url.endsWith('/openjpeg.wasm'))).toBe(true);
    expect(resources.observed.some(url => url.endsWith('/openjpeg_nowasm_fallback.js'))).toBe(blockWasm);
    expectLocalDecoderRequests(page, resources.observed);
    await page.getByRole('button', { name: '保存现场', exact: true }).click();
    await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
    expect(await durableHash(page)).toBe(sourceHash);
    await page.reload(); await page.getByRole('button', { name: /jpx-scan\.pdf/ }).click();
    await expectDecoded(reference.locator('canvas')); expect(await durableHash(page)).toBe(sourceHash);
    await info.attach('decoded-jpx-reference', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('decoder-requests', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' });
  });
}

for (const fallback of [false, true]) for (const blockWasm of [false, true]) {
  test(`thumbnail decoder ${blockWasm ? 'JavaScript fallback' : 'native WASM'} works in the ${fallback ? 'main-thread fallback' : 'custom worker'}`, async ({ page }, info) => {
    const requests = await isolateDecoders(page, fallback, blockWasm);
    await page.goto('./'); await importBook(page, fixture);
    // The thumbnail assertion is deliberately independent of reader pixels so a
    // baseline failure proves this pipeline too, rather than stopping at reader.
    // A square bitmap plus visible canvas excludes React-PDF's initial 300x150
    // element and its hidden in-flight raster. Blank successful baseline pixels
    // still pass this readiness check, so thumbnail failures remain independent.
    await expect.poll(() => reader(page).locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
      canvas.width > 0 && canvas.width === canvas.height && getComputedStyle(canvas).visibility === 'visible')).toBe(true);
    const before = requests.filter(url => url.endsWith('/openjpeg.wasm')).length;
    await page.getByRole('button', { name: /^速翻/ }).click();
    await expectThumbnail(quickFlip(page).getByRole('button', { name: '选择第 1 页', exact: true }).locator('img'));
    await quickFlip(page).getByRole('button', { name: '夹住此页', exact: true }).click(); await page.keyboard.press('Escape');
    if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: '夹页 1', exact: true }).click();
    const image = page.getByRole('complementary', { name: '夹页列表' }).getByRole('img', { name: '第 1 页缩略图', exact: true });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(60);
    await expectThumbnail(image);
    const evidence = await page.evaluate(() => (window as unknown as { leafspaceDecoderEvidence: { customCreated: number; customSuccess: number; customErrors: number } }).leafspaceDecoderEvidence);
    const resources = await decoderResourceEvidence(page, requests);
    await info.attach('thumbnail-decoder-before-assert', { body: JSON.stringify({ evidence, ...resources }, null, 2), contentType: 'application/json' });
    expect(evidence.customCreated).toBe(fallback ? 0 : 1);
    if (!fallback) { expect(evidence.customSuccess).toBeGreaterThan(0); expect(evidence.customErrors).toBe(0); }
    expect(requests.filter(url => url.endsWith('/openjpeg.wasm')).length).toBeGreaterThan(before);
    expect(resources.observed.some(url => url.endsWith('/openjpeg_nowasm_fallback.js'))).toBe(blockWasm);
    expectLocalDecoderRequests(page, resources.observed);
    await expect.poll(async () => (await snapshots(page))[0]?.heldPages.map(item => item.pageNumber)).toEqual([1]);
    expect(await durableHash(page)).toBe(sourceHash);
    await info.attach('decoded-jpx-held-page', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('decoder-worker-evidence', { body: JSON.stringify({ evidence, requests, samples: await thumbnailSamples(image) }, null, 2), contentType: 'application/json' });
  });
}

test('local decoder binaries and notices are real assets rather than SPA fallback HTML', async ({ request, baseURL }) => {
  for (const name of ['openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'qcms_bg.wasm', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_QCMS', 'LICENSE_PDFJS_QCMS', 'LICENSE_PDFJS']) {
    const response = await request.get(new URL(`pdfjs/${version}/wasm/${name}`, baseURL).href);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    const original = readFileSync(name === 'LICENSE_PDFJS' ? join(pdfjsRoot, 'LICENSE') : join(pdfjsRoot, 'wasm', name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
    if (name.endsWith('.wasm')) { expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 97, 115, 109]); expect(response.headers()['content-type']).toContain('application/wasm'); }
    if (name.endsWith('.js')) expect(response.headers()['content-type']).toMatch(/(?:java|ecma)script/);
  }
});
