import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { WorkspaceSnapshot } from '../../types/domain';
import { test as base, expect, BOOK_NAME, BOOK_PATH, importBook, reader, expectMainPage, snapshots } from './helpers';

interface StorageProbe { workspacePuts: number; assetPuts: number; failWorkspaceRead: boolean }

// Observe native storage, with an opt-in read failure only for the recovery case.
// There are no application-store imports, injected snapshots, or product hooks.
async function installStorageProbe(page: Page) {
  await page.addInitScript(() => {
    // Engines differ in whether an inactive real tab reports itself hidden.
    // Keep setup's lifecycle explicit so a paused debounce cannot be bypassed
    // by an immediate hidden save. The hidden case changes these same values.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const state = { workspacePuts: 0, assetPuts: 0, failWorkspaceRead: false };
    Object.assign(window, { leafspaceConcurrencyProbe: state });
    const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'workspaces') state.workspacePuts++;
      if (this.name === 'books') state.assetPuts++;
      return put.apply(this, args);
    };
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'workspaces' && state.failWorkspaceRead) {
        throw new DOMException('Synthetic cross-tab reload read failure', 'UnknownError');
      }
      return get.apply(this, args);
    };
  });
}

async function probe(page: Page, changes: Partial<StorageProbe> = {}) {
  return page.evaluate(changes => {
    const state = (window as unknown as { leafspaceConcurrencyProbe: StorageProbe }).leafspaceConcurrencyProbe;
    Object.assign(state, changes);
    return state;
  }, changes);
}

async function localPdf(page: Page) {
  return page.evaluate(async () => {
    const assets = await new Promise<{ documentId: string; bytes?: ArrayBuffer; blob?: Blob }[]>((resolve, reject) => {
      const request = indexedDB.open('leafspace');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('books', 'readonly');
        const read = transaction.objectStore('books').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
        transaction.oncomplete = transaction.onabort = () => db.close();
      };
    });
    return Promise.all(assets.map(async asset => {
      const bytes = asset.bytes ?? await asset.blob!.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return { documentId: asset.documentId, size: bytes.byteLength,
        sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
    }));
  });
}

const saved = (page: Page) => page.getByText('已保存到本机', { exact: true });
const confirmation = (page: Page) => page.getByRole('group', { name: '确认解决现场冲突', exact: true });
const recent = (page: Page) => page.getByRole('button', { name: /leafspace-12-pages\.pdf/ });

async function freezeDebounce(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
}

// Native promises/IndexedDB/worker messages continue while the debounce is paused.
// Check semantic reading state here; resume the clock before requiring PDF paint.
async function navigateWhilePaused(page: Page, number: number) {
  await reader(page).focus();
  const input = page.getByRole('textbox', { name: '输入页码', exact: true });
  await input.fill(String(number));
  await input.press('Enter');
  await expect(page.locator('header')).toContainText(`第 ${number} 页`);
  await reader(page).focus();
}

async function arrangeWorkspace(page: Page, number: number, layout: 'floating' | 'split') {
  await navigateWhilePaused(page, number);
  if (layout === 'floating') await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await page.getByRole('button', { name: `打开第 ${number} 页参考窗口`, exact: true }).click();
  if (layout === 'split') await page.getByRole('combobox', { name: '工作区布局', exact: true }).selectOption('split');
  // Flush the reference's focus frame, well short of the 500 ms save deadline.
  await page.clock.runFor(50);
  await reader(page).focus();
}

async function expectLiveWorkspace(page: Page, mainPage: number, referencePage: number, layout: 'floating' | 'split') {
  await expect(page.locator('header')).toContainText(`${BOOK_NAME} · 第 ${mainPage} 页`);
  await expect(page.getByRole('heading', { name: '夹住的页面 (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `阅读第 ${referencePage} 页`, exact: true })).toBeVisible();
  const metadata = layout === 'floating' ? ['本页的定义', '尚未保存的推导'] : ['另一标签的定义', '已经保存的证明'];
  for (const text of metadata) await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /^参考阅读区，第 \d+ 页$/ })).toHaveCount(1);
  await expect(page.getByRole('region', { name: `参考阅读区，第 ${referencePage} 页`, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '工作区布局', exact: true })).toHaveValue(layout);
  const mainShell = reader(page).locator('xpath=ancestor::*[@data-reader-shell][1]');
  await expect(mainShell.getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText(layout === 'floating' ? '120%' : '100%');
  if (layout === 'floating') await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  else await expect(page.getByRole('separator', { name: '调整主窗口与分栏宽度', exact: true })).toBeVisible();
}

async function nameHeldPage(page: Page, number: number, local: boolean) {
  await page.getByRole('button', { name: `编辑第 ${number} 页名称和备注`, exact: true }).click();
  const editor = page.getByRole('form', { name: `编辑第 ${number} 页名称和备注`, exact: true });
  await editor.getByRole('textbox', { name: '名称', exact: true }).fill(local ? '本页的定义' : '另一标签的定义');
  await editor.getByRole('textbox', { name: '备注', exact: true }).fill(local ? '尚未保存的推导' : '已经保存的证明');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
}

async function saveNow(page: Page) {
  // Every caller has just made a real edit with its clock paused. Require the
  // dirty indicator first, then a changed durable record, not an old Saved label.
  await expect(saved(page)).not.toBeVisible();
  const previous = (await snapshots(page))[0];
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(saved(page)).toBeVisible();
  await expect.poll(async () => (await snapshots(page))[0]).not.toEqual(previous);
  return (await snapshots(page))[0];
}

async function expectConflict(page: Page) {
  await expect(page.getByRole('alert')).toContainText('另一个标签页');
  await expect(page.getByRole('button', { name: '载入已存现场', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '用此页覆盖', exact: true })).toBeVisible();
  await expect(saved(page)).not.toBeVisible();
}

async function requestResolution(page: Page, choice: 'load' | 'overwrite') {
  await page.getByRole('button', { name: choice === 'load' ? '载入已存现场' : '用此页覆盖', exact: true }).click();
  await expect(confirmation(page)).toBeVisible();
  await expect(confirmation(page).getByRole('button', { name: choice === 'load' ? '确认载入' : '确认覆盖', exact: true })).toBeVisible();
}

async function unchangedConflict(page: Page, durable: WorkspaceSnapshot, referenceId: string) {
  expect((await snapshots(page))[0]).toEqual(durable);
  expect((await probe(page)).workspacePuts).toBe(0);
  await expectLiveWorkspace(page, 3, 3, 'floating');
  await expect(page.locator('[data-floating-window]')).toHaveAttribute('data-window-id', referenceId);
}

async function visibility(page: Page, hidden: boolean) {
  // Same lifecycle contract as hidden-save.test.ts. Both real tabs stay alive;
  // this does not claim a browser/tab-close or mobile process-kill simulation.
  await page.evaluate(hidden => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const test = base.extend<{ competingTabs: { newer: Page; stale: Page; durable: WorkspaceSnapshot; localReferenceId: string } }>({
  competingTabs: async ({ page, context }, runTest, info) => {
    const stale = await context.newPage();
    const errors: string[] = [];
    stale.on('pageerror', error => errors.push(error.message));
    for (const tab of [page, stale]) { await installStorageProbe(tab); await tab.clock.install(); }

    await page.goto('/');
    await importBook(page);
    await expect(saved(page)).toBeVisible();
    await reader(page).focus();
    await freezeDebounce(page);
    await expect(saved(page)).toBeVisible();
    const baseline = (await snapshots(page))[0];
    const original = await readFile(BOOK_PATH);
    const originalPdf = [{ documentId: baseline.documentId, size: original.byteLength,
      sha256: createHash('sha256').update(original).digest('hex') }];
    expect(await localPdf(page)).toEqual(originalPdf);
    await probe(page, { assetPuts: 0, workspacePuts: 0 });

    await stale.goto('/');
    await expect(recent(stale)).toBeVisible();
    // Pause in the library, before opening can schedule its first autosave.
    // Both tabs therefore begin from exactly the same real durable revision.
    await freezeDebounce(stale);
    await recent(stale).click();
    await expect(stale.locator('header')).toContainText(`${BOOK_NAME} · 第 1 页`);
    await expect(stale.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
    await expect(reader(stale)).toBeVisible();
    expect((await snapshots(stale))[0]).toEqual(baseline);

    await arrangeWorkspace(stale, 3, 'floating');
    await nameHeldPage(stale, 3, true);
    const localReferenceId = await stale.locator('[data-floating-window]').getAttribute('data-window-id');
    if (!localReferenceId) throw new Error('The stale tab did not create its reference window');
    await arrangeWorkspace(page, 7, 'split');
    await nameHeldPage(page, 7, false);
    const durable = await saveNow(page);
    expect(durable).toMatchObject({ currentPage: 7, layoutPreset: 'split', heldPages: [{ pageNumber: 7 }] });
    await expectLiveWorkspace(stale, 3, 3, 'floating');
    expect((await probe(stale)).workspacePuts).toBe(0);

    try { await runTest({ newer: page, stale, durable, localReferenceId }); }
    finally {
      expect(await localPdf(page), 'Every conflict/resolution retains the original generated PDF bytes').toEqual(originalPdf);
      expect((await probe(page)).assetPuts).toBe(0);
      expect((await probe(stale)).assetPuts).toBe(0);
      expect(errors, 'No uncaught exceptions in the second real tab').toEqual([]);
      await info.attach('cross-tab-final-storage', { body: JSON.stringify({ snapshots: await snapshots(page), pdf: originalPdf }), contentType: 'application/json' });
      await stale.close();
    }
  },
});

test.describe.configure({ timeout: 60_000 });

test('stale autosave and manual save preserve both workspaces; loading a newer scene requires fresh confirmation', async ({ competingTabs }, info) => {
  const { newer, stale, durable, localReferenceId } = competingTabs;
  await stale.clock.runFor(600);
  await expectConflict(stale);
  await unchangedConflict(stale, durable, localReferenceId);

  await stale.getByRole('button', { name: '关闭提示', exact: true }).click();
  await stale.getByRole('button', { name: '保存现场', exact: true }).click();
  await expectConflict(stale);
  await unchangedConflict(stale, durable, localReferenceId);
  await requestResolution(stale, 'load');
  await confirmation(stale).getByRole('button', { name: '取消处理', exact: true }).click();
  await expect(confirmation(stale)).toHaveCount(0);
  await unchangedConflict(stale, durable, localReferenceId);

  await requestResolution(stale, 'load');
  await navigateWhilePaused(newer, 8);
  const latest = await saveNow(newer);
  await confirmation(stale).getByRole('button', { name: '确认载入', exact: true }).click();
  await expectConflict(stale);
  await expect(confirmation(stale)).toHaveCount(0);
  await unchangedConflict(stale, latest, localReferenceId);
  await stale.clock.runFor(1_500);
  await unchangedConflict(stale, latest, localReferenceId);

  await requestResolution(stale, 'load');
  await confirmation(stale).getByRole('button', { name: '确认载入', exact: true }).click();
  await expectLiveWorkspace(stale, 8, 7, 'split');
  await expect(stale.getByRole('alert')).toHaveCount(0);
  expect((await snapshots(stale))[0]).toEqual(latest);
  expect((await probe(stale)).workspacePuts).toBe(0);
  await stale.clock.resume();
  await expectMainPage(stale, 8);
  await expect(stale.getByRole('region', { name: '参考阅读区，第 7 页', exact: true }).locator('canvas')).toBeVisible();
  await info.attach('newer-scene-loaded-after-fresh-confirmation', { body: await stale.screenshot(), contentType: 'image/png' });
});

test('a stale hidden save stays blocked after dismissal and a library transition preserves the live scene', async ({ competingTabs }, info) => {
  const { stale, durable, localReferenceId } = competingTabs;
  await visibility(stale, true);
  await expectConflict(stale);
  await unchangedConflict(stale, durable, localReferenceId);
  await visibility(stale, false);
  await stale.getByRole('button', { name: '关闭提示', exact: true }).click();
  await visibility(stale, true);
  await visibility(stale, false);
  await stale.clock.runFor(1_500);
  await unchangedConflict(stale, durable, localReferenceId);

  await stale.getByRole('button', { name: '回到书库', exact: true }).click();
  await expectConflict(stale);
  await expect(stale.getByRole('heading', { name: '页境阅读', exact: true })).toHaveCount(0);
  await unchangedConflict(stale, durable, localReferenceId);
  await stale.clock.resume();
  await expectMainPage(stale, 3);
  await info.attach('hidden-conflict-blocks-library-exit', { body: await stale.screenshot(), contentType: 'image/png' });
  expect((await snapshots(stale))[0]).toEqual(durable);
});

test('confirmed overwrite saves this tab and survives returning to the library and reopening', async ({ competingTabs }, info) => {
  const { newer, stale, durable, localReferenceId } = competingTabs;
  await stale.getByRole('button', { name: '保存现场', exact: true }).click();
  await expectConflict(stale);
  await requestResolution(stale, 'overwrite');
  await confirmation(stale).getByRole('button', { name: '取消处理', exact: true }).focus();
  await stale.keyboard.press('Escape');
  await expect(confirmation(stale)).toHaveCount(0);
  await unchangedConflict(stale, durable, localReferenceId);

  await requestResolution(stale, 'overwrite');
  await confirmation(stale).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await expect(saved(stale)).toBeVisible();
  const chosen = (await snapshots(stale))[0];
  expect(chosen).toMatchObject({ currentPage: 3, scale: 1.2, layoutPreset: 'single', heldPages: [{ pageNumber: 3 }] });
  expect(chosen.windows.find(window => window.canClose)).toMatchObject({ id: localReferenceId, pageNumber: 3, dockMode: 'none' });
  await expectLiveWorkspace(stale, 3, 3, 'floating');
  await expectLiveWorkspace(newer, 7, 7, 'split');

  await stale.clock.resume();
  await expectMainPage(stale, 3);
  await stale.getByRole('button', { name: '回到书库', exact: true }).click();
  await expect(stale.getByRole('heading', { name: '页境阅读', exact: true })).toBeVisible();
  await recent(stale).click();
  await expectMainPage(stale, 3);
  await expectLiveWorkspace(stale, 3, 3, 'floating');
  await expect(stale.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
  await info.attach('chosen-local-scene-reopened', { body: await stale.screenshot(), contentType: 'image/png' });
});

test('a competing save during overwrite confirmation requires a fresh explicit decision', async ({ competingTabs }) => {
  const { newer, stale, localReferenceId } = competingTabs;
  await stale.getByRole('button', { name: '保存现场', exact: true }).click();
  await expectConflict(stale);
  await requestResolution(stale, 'overwrite');
  await navigateWhilePaused(newer, 8);
  const latest = await saveNow(newer);
  await confirmation(stale).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await expectConflict(stale);
  await expect(confirmation(stale)).toHaveCount(0);
  await unchangedConflict(stale, latest, localReferenceId);
  await stale.clock.runFor(1_500);
  await unchangedConflict(stale, latest, localReferenceId);

  await requestResolution(stale, 'overwrite');
  await confirmation(stale).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await expect(saved(stale)).toBeVisible();
  expect((await snapshots(stale))[0]).toMatchObject({ currentPage: 3, heldPages: [{ pageNumber: 3 }] });
  expect((await probe(stale)).workspacePuts).toBe(1);
  await expectLiveWorkspace(stale, 3, 3, 'floating');
});

test('a failed conflict reload retains local pages and windows; a newer saved scene requires fresh confirmation', async ({ competingTabs }) => {
  const { newer, stale, durable, localReferenceId } = competingTabs;
  await stale.getByRole('button', { name: '保存现场', exact: true }).click();
  await expectConflict(stale);
  await requestResolution(stale, 'load');
  await probe(stale, { failWorkspaceRead: true });
  await confirmation(stale).getByRole('button', { name: '确认载入', exact: true }).click();
  await expect(stale.getByRole('alert')).toContainText('Synthetic cross-tab reload read failure');
  await unchangedConflict(stale, durable, localReferenceId);

  await navigateWhilePaused(newer, 8);
  const latest = await saveNow(newer);
  await probe(stale, { failWorkspaceRead: false });
  await requestResolution(stale, 'load');
  await confirmation(stale).getByRole('button', { name: '确认载入', exact: true }).click();
  await expectConflict(stale);
  await expect(confirmation(stale)).toHaveCount(0);
  await unchangedConflict(stale, latest, localReferenceId);

  await requestResolution(stale, 'load');
  await confirmation(stale).getByRole('button', { name: '确认载入', exact: true }).click();
  await expectLiveWorkspace(stale, 8, 7, 'split');
  await expect(stale.getByRole('alert')).toHaveCount(0);
  expect((await snapshots(stale))[0]).toEqual(latest);
  expect((await probe(stale)).workspacePuts).toBe(0);
  await stale.clock.resume();
  await expectMainPage(stale, 8);
});
