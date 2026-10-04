import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect, importBook, reader, quickFlip, snapshots, reopenRecent } from './helpers';

const fixture = fileURLToPath(new URL('../fixtures/leafspace-links.pdf', import.meta.url));
const colors = [[51, 128, 77], [26, 89, 179], [179, 64, 26]];
const annotation = (region: Locator, id: string) => region.locator(`.annotationLayer [data-annotation-id="${id}"] a`);
type LinkGate = { holding: boolean; queued: number; workers: number; pending: number; responses: number; release: () => void };
const gate = (page: Page) => page.evaluate(() => {
  const { holding, queued, workers, pending, responses } = (window as unknown as { leafspaceLinkGate: LinkGate }).leafspaceLinkGate;
  return { holding, queued, workers, pending, responses };
});
async function installGate(page: Page) {
  await page.addInitScript(() => {
    const pending: (() => void)[] = [];
    const state = { holding: false, queued: 0, workers: 0, pending: 0, responses: 0, release() { state.holding = false; pending.splice(0).forEach(send => send()); } };
    Object.assign(window, { leafspaceLinkGate: state });
    const NativeWorker = window.Worker, postMessage = NativeWorker.prototype.postMessage;
    window.Worker = class extends NativeWorker {
      requests = new Set<string>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); state.workers++;
        this.addEventListener('message', event => {
          const message = event.data;
          if (message?.callback && this.requests.delete(`${message.targetName}:${message.callbackId}`)) { state.pending--; state.responses++; }
        });
      }
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const request = message as { action?: string; sourceName?: string; callbackId?: number; data?: { id?: string } };
        if (['GetDestination', 'GetPageIndex'].includes(request?.action ?? '') && typeof request.callbackId === 'number') {
          this.requests.add(`${request.sourceName}:${request.callbackId}`); state.pending++;
        }
        const send = () => Reflect.apply(postMessage, this, options === undefined ? [message] : [message, options]);
        if (state.holding && request?.action === 'GetDestination' && request.data?.id === 'chapter') { state.queued++; pending.push(send); }
        else send();
      }
    };
  });
}
async function holdNamedLink(page: Page) {
  await page.evaluate(() => { (window as unknown as { leafspaceLinkGate: LinkGate }).leafspaceLinkGate.holding = true; });
  await annotation(reader(page), '11R').focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await gate(page)).queued).toBe(1);
}
async function releaseAndSettle(page: Page) {
  await page.evaluate(() => (window as unknown as { leafspaceLinkGate: LinkGate }).leafspaceLinkGate.release());
  await expect.poll(async () => { const state = await gate(page); return state.responses > 0 && state.pending === 0; }).toBe(true);
  // Worker replies and their Promise continuations precede this paint boundary.
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  return (await snapshots(page))[0];
}
async function sourceHash(page: Page) {
  return page.evaluate(async () => {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const opening = indexedDB.open('leafspace'); opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('books', 'readonly'), request = tx.objectStore('books').getAll();
        request.onsuccess = async () => { try { resolve(request.result[0].bytes ?? await request.result[0].blob.arrayBuffer()); } catch (error) { reject(error); } };
        request.onerror = () => reject(request.error); tx.oncomplete = () => db.close(); tx.onabort = () => db.close();
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

async function expectPage(region: Locator, pageNumber: number) {
  await expect(region.locator('.react-pdf__Page')).toHaveAttribute('data-page-number', String(pageNumber));
  await expect(region.locator('canvas')).toBeVisible();
  await expect.poll(async () => {
    const pixel = await region.locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * 50 / 420), Math.floor(canvas.height * 27 / 594), 1, 1).data));
    return pixel[3] === 255 && colors[pageNumber - 1].every((channel, index) => Math.abs(channel - pixel[index]) <= 1);
  }, { message: `Page ${pageNumber} has its own decoded color bar` }).toBe(true);
}

test('a numeric internal PDF link renders its unmounted target in the main reader', async ({ page }, info) => {
  await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  const documentNode = await reader(page).locator('.react-pdf__Document').elementHandle(), before = await gate(page);
  await annotation(reader(page), '10R').click();
  await expectPage(reader(page), 2); await expect(page.locator('header')).toContainText('第 2 页');
  await annotation(reader(page), '15R').click(); await expectPage(reader(page), 1);
  await annotation(reader(page), '10R').focus(); await page.keyboard.press('Enter');
  await expectPage(reader(page), 2); await expect(reader(page)).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 3);
  expect(await documentNode!.evaluate(element => element.isConnected)).toBe(true); expect((await gate(page)).workers).toBe(before.workers);
  await save(page); expect(await sourceHash(page)).toBe(createHash('sha256').update(readFileSync(fixture)).digest('hex'));
  await reopenRecent(page, 'leafspace-links.pdf'); await expectPage(reader(page), 3);
  await info.attach('internal-main-link-destination', { body: await page.screenshot(), contentType: 'image/png' });
});

test('a named internal PDF link navigates its reference even when main already renders the destination', async ({ page }, info) => {
  test.skip(['tablet', 'mobile', 'mobile-webkit'].includes(info.project.name), 'Simultaneously visible main and reference ownership');
  await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  await page.getByRole('button', { name: /^速翻/ }).click(); await expect(quickFlip(page)).toBeVisible();
  await page.keyboard.press('n');
  const reference = page.getByRole('region', { name: /^参考阅读区/ }); await expectPage(reference, 1);
  await reader(page).focus(); await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 2);
  await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 3);
  await annotation(reference, '11R').click();
  await expectPage(reference, 3); await expectPage(reader(page), 3);
  await annotation(reference, '16R').click(); await expectPage(reference, 1);
  await annotation(reference, '11R').focus(); await page.keyboard.press('Enter');
  await expectPage(reference, 3); await expect(reference).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expectPage(reference, 2); await expectPage(reader(page), 3);
  await expect(page.locator('header')).toContainText('第 3 页');
  const saved = await save(page); expect(saved.currentPage).toBe(3); expect(saved.windows.find(window => window.id !== 'main')?.pageNumber).toBe(2);
  await reopenRecent(page, 'leafspace-links.pdf'); await expectPage(reader(page), 3); await expectPage(reference, 2);
  await info.attach('internal-reference-link-destination', { body: await page.screenshot(), contentType: 'image/png' });
});

for (const [id, kind] of [['11R', 'named'], ['12R', 'indirect-reference']] as const) {
  test(`a ${kind} main-reader destination resolves through the real PDF worker`, async ({ page }, info) => {
    await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
    const external = annotation(reader(page), '14R');
    await expect(external).toHaveAttribute('href', 'https://example.com/paper');
    await expect(external).toHaveAttribute('rel', /noopener/); await expect(external).toHaveAttribute('rel', /noreferrer/);
    await annotation(reader(page), id).click(); await expectPage(reader(page), 3);
    await info.attach(`internal-${kind}-destination`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('same-page link Enter retains annotation focus and existing owner-scoped scroll behavior', async ({ page }, info) => {
  await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('207%'); await expectPage(reader(page), 1);
  const link = annotation(reader(page), '13R'); await link.focus();
  await page.keyboard.press('Enter'); await expectPage(reader(page), 1); await expect(link).toBeFocused();
  await expect.poll(() => reader(page).evaluate(element => Math.abs(element.querySelector('.react-pdf__Page')!.getBoundingClientRect().top - element.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: '恢复适合宽度' })).toHaveText('207%');
  await info.attach('same-page-link-scroll', { body: await page.screenshot(), contentType: 'image/png' });
});

for (const newerFocus of ['main', 'reference-toolbar'] as const) {
  test(`a delayed named reference link preserves newer ${newerFocus} focus`, async ({ page }, info) => {
    test.skip(['tablet', 'mobile', 'mobile-webkit'].includes(info.project.name), 'Simultaneously visible reference and alternate focus target');
    await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
    await page.getByRole('button', { name: /^速翻/ }).click(); await expect(quickFlip(page)).toBeVisible(); await page.keyboard.press('n');
    const reference = page.getByRole('region', { name: /^参考阅读区/ }); await expectPage(reference, 1);
    await reader(page).focus(); await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 2);
    await page.evaluate(() => { (window as unknown as { leafspaceLinkGate: LinkGate }).leafspaceLinkGate.holding = true; });
    await annotation(reference, '11R').focus(); await page.keyboard.press('Enter');
    await expect.poll(async () => (await gate(page)).queued).toBe(1); await expectPage(reference, 1);
    const newer = newerFocus === 'main' ? reader(page) : reference.locator('xpath=ancestor::*[@data-reader-shell][1]').getByRole('button', { name: '放大', exact: true });
    await newer.focus();
    await page.evaluate(() => (window as unknown as { leafspaceLinkGate: LinkGate }).leafspaceLinkGate.release());
    await expectPage(reference, 3); await expectPage(reader(page), 2); await expect(newer).toBeFocused();
    await info.attach(`delayed-link-${newerFocus}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('manual navigation away and back supersedes a pending PDF link', async ({ page }) => {
  await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  await holdNamedLink(page); await reader(page).focus();
  await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 2);
  await page.keyboard.press('ArrowLeft'); await expectPage(reader(page), 1);
  await releaseAndSettle(page); await expectPage(reader(page), 1); await expect(reader(page)).toBeFocused();
});

test('a newer numeric link supersedes a pending PDF link', async ({ page }) => {
  await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  await holdNamedLink(page); await annotation(reader(page), '10R').click(); await expectPage(reader(page), 2);
  await releaseAndSettle(page); await expectPage(reader(page), 2);
});

for (const action of ['Home', 'page-input'] as const) {
  test(`same-page ${action} navigation supersedes a pending PDF link`, async ({ page }) => {
    await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
    await holdNamedLink(page);
    if (action === 'Home') { await reader(page).focus(); await page.keyboard.press('Home'); }
    else { const input = page.getByRole('textbox', { name: '输入页码' }); await input.fill('1'); await input.press('Enter'); }
    await releaseAndSettle(page); await expectPage(reader(page), 1);
  });
}

test('missing internal destination has dismissible feedback and keeps a reference window open on Escape', async ({ page }, info) => {
  test.skip(['tablet', 'mobile', 'mobile-webkit'].includes(info.project.name), 'Simultaneously visible reference ownership');
  await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  await page.getByRole('button', { name: /^速翻/ }).click(); await expect(quickFlip(page)).toBeVisible(); await page.keyboard.press('n');
  const reference = page.getByRole('region', { name: /^参考阅读区/ }); await expectPage(reference, 1);
  await annotation(reference, '17R').click();
  await expect(page.getByRole('alert')).toContainText('无法打开此链接');
  await page.getByRole('button', { name: '关闭链接提示' }).focus(); await page.keyboard.press('Escape');
  await expect(page.getByText('无法打开此链接。可尝试目录或页码导航。')).toHaveCount(0);
  await expectPage(reference, 1); await expect(reference).toBeFocused(); await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  await annotation(reference, '10R').click(); await expectPage(reference, 2);
});

test('post-pinch internal-link ghost click is suppressed before PDF resolution while keyboard remains available', async ({ page }) => {
  await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  const before = await gate(page);
  const canceled = await reader(page).evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + 100;
    const touches = [1, 2].map((identifier, index) => ({ identifier, target: element, clientX: x + (index ? 40 : -40), clientY: y }));
    for (const type of ['touchstart', 'touchend']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchstart' ? touches : [] }, changedTouches: { value: touches } });
      element.dispatchEvent(event);
    }
    const link = element.querySelector<HTMLAnchorElement>('[data-annotation-id="11R"] a')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    link.dispatchEvent(click);
    return click.defaultPrevented;
  });
  expect(canceled).toBe(true); expect((await gate(page)).pending).toBe(before.pending); expect((await gate(page)).responses).toBe(before.responses);
  await expectPage(reader(page), 1);
  await annotation(reader(page), '11R').focus(); await page.keyboard.press('Enter'); await expectPage(reader(page), 3);
});

for (const action of ['open', 'cancel', 'commit'] as const) {
  test(`QuickFlip ${action} supersedes a pending PDF link`, async ({ page }) => {
    await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
    await holdNamedLink(page); await reader(page).focus(); await page.keyboard.press('Space'); await expect(quickFlip(page)).toBeVisible();
    if (action === 'cancel') { await page.keyboard.press('Escape'); await expect(quickFlip(page)).toHaveCount(0); }
    if (action === 'commit') {
      await quickFlip(page).getByRole('button', { name: '选择第 2 页', exact: true }).click();
      await quickFlip(page).getByRole('button', { name: '阅读此页', exact: true }).click(); await expectPage(reader(page), 2);
    }
    await releaseAndSettle(page);
    const currentPaper = page.locator('[data-window-id="main"] .react-pdf__Page');
    await expect(currentPaper).toHaveAttribute('data-page-number', action === 'commit' ? '2' : '1');
    if (action === 'open') { await expect(quickFlip(page)).toBeVisible(); await page.keyboard.press('Escape'); }
    await expectPage(reader(page), action === 'commit' ? 2 : 1); await expect(reader(page)).toBeFocused();
  });
}

for (const action of ['commit', 'cancel'] as const) {
  test(`timeline preview ${action} supersedes an older PDF link before pointer release`, async ({ page }) => {
    await installGate(page); await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
    await holdNamedLink(page);
    const slider = page.getByRole('slider', { name: '跳转到页码' }), box = await slider.boundingBox();
    if (!box) throw new Error('Missing timeline');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await expect(slider).toHaveValue('2'); await expect(slider).toHaveAttribute('aria-valuetext', /^预览：/);
    await releaseAndSettle(page); await expectPage(reader(page), 1);
    if (action === 'cancel') await page.keyboard.press('Escape');
    await page.mouse.up(); await expectPage(reader(page), action === 'commit' ? 2 : 1);
  });
}
