import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, importBook, navigateTo, snapshots, reopenRecent, reader, BOOK_PATH, OTHER_BOOK_PATH } from './helpers';

const sourceHash = createHash('sha256').update(readFileSync(BOOK_PATH)).digest('hex');
type ImeEventRecord = { type: string; key?: string; keyCode?: number; isComposing?: boolean; isTrusted: boolean; defaultPrevented: boolean };
type ImeProbe = { events: Event[]; stop: () => void };
const imeEvents = (page: Page): Promise<ImeEventRecord[]> => page.evaluate(() =>
  (window as unknown as { leafspaceMetadataIme: ImeProbe }).leafspaceMetadataIme.events.map(event => ({
    type: event.type, isTrusted: event.isTrusted, defaultPrevented: event.defaultPrevented,
    ...(event instanceof KeyboardEvent ? { key: event.key, keyCode: event.keyCode, isComposing: event.isComposing } : {}),
  })));
const form = (page: Page) => page.getByRole('form', { name: '编辑第 8 页名称和备注', exact: true });
const edit = (page: Page) => page.getByRole('button', { name: '编辑第 8 页名称和备注', exact: true });
async function openPanel(page: Page) {
  const toggle = page.getByRole('button', { name: '夹页 1', exact: true });
  if ((page.viewportSize()?.width ?? 0) < 1024 && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
async function expectHeldPanelChrome(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) return;
  const back = page.getByRole('button', { name: '← 返回阅读', exact: true });
  await expect(back).toBeVisible();
  const geometry = await back.evaluate(button => {
    const aside = button.closest('aside')!, main = aside.closest('main')!;
    const rect = button.getBoundingClientRect(), bounds = aside.getBoundingClientRect(), mainBounds = main.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(button);
    const text = Array.from(range.getClientRects());
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { height: rect.height, top: rect.top, mainTop: mainBounds.top, asideTop: bounds.top, asideScroll: aside.scrollTop,
      mainScroll: main.scrollTop, textContained: text.every(line => line.top >= Math.max(rect.top, mainBounds.top) - 1
        && line.bottom <= Math.min(rect.bottom, mainBounds.bottom) + 1),
      centerReachable: !!hit && button.contains(hit), outerScroll: document.documentElement.scrollTop + document.body.scrollTop };
  });
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.asideTop - 1);
  expect(geometry).toMatchObject({ asideScroll: 0, mainScroll: 0, textContained: true, centerReachable: true, outerScroll: 0 });
  return geometry;
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  return (await snapshots(page))[0];
}
async function bytesHash(page: Page) {
  return page.evaluate(async () => {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const open = indexedDB.open('leafspace'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('books', 'readonly'), request = tx.objectStore('books').getAll();
        request.onsuccess = async () => { try { resolve(request.result[0].bytes ?? await request.result[0].blob.arrayBuffer()); } catch (error) { reject(error); } };
        request.onerror = () => reject(request.error); tx.oncomplete = () => db.close(); tx.onabort = () => db.close();
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
async function prepare(page: Page) {
  await page.goto('/'); await importBook(page); await navigateTo(page, 8);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await navigateTo(page, 3); await openPanel(page);
}

test('held names and notes keep the reading scene and original PDF intact through saved reopen', async ({ page, browserName }, info) => {
  await prepare(page);
  const before = await save(page);
  await edit(page).click(); await expect(form(page).getByRole('textbox', { name: '名称', exact: true })).toBeFocused();
  const name = '定义与证明' + 'a'.repeat(75);
  const note = '对照第二章的图示\n回看这个定义与证明';
  const input = form(page).getByRole('textbox', { name: '名称', exact: true });
  await input.evaluate(element => {
    const container = element.closest('form')!, events: Event[] = [];
    const types = ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup', 'submit'];
    // Retain order here, but inspect final fields from a later evaluation after
    // dispatch finishes. Native events can checkpoint microtasks between listeners.
    const observe = (event: Event) => { events.push(event); };
    types.forEach(type => container.addEventListener(type, observe, true));
    Object.assign(window, { leafspaceMetadataIme: { events, stop: () => types.forEach(type => container.removeEventListener(type, observe, true)) } });
  });
  const phases: Record<string, ImeEventRecord[]> = {};
  try {
    // Firefox fill uses commitCompositionWith: finish that real driver insertion
    // before starting the separately controlled ongoing-composition contract.
    await input.fill(name);
    const fillEvents = phases.fillEvents = await imeEvents(page);
    if (browserName === 'firefox') {
      const start = fillEvents.findIndex(event => event.type === 'compositionstart');
      const end = fillEvents.findIndex(event => event.type === 'compositionend');
      expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
    }
    await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
    await input.press('Enter'); await expect(form(page)).toBeVisible();
    await input.press('Escape'); await expect(form(page)).toBeVisible();
    const ongoing = phases.ongoing = (await imeEvents(page)).slice(fillEvents.length);
    expect(ongoing.some(event => event.type === 'compositionstart')).toBe(true);
    expect(ongoing.some(event => event.type === 'compositionend' || event.type === 'submit')).toBe(false);
    expect(ongoing.find(event => event.type === 'keydown' && event.key === 'Enter')).toMatchObject({ defaultPrevented: true });
    await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
    const postStart = (await imeEvents(page)).length;
    // Native Enter retains the browser's implicit-submit default action. Override
    // only this event's reported legacy IME code, instead of untrusted dispatch.
    await input.evaluate(element => element.addEventListener('keydown', event => {
      Object.defineProperty(event, 'keyCode', { configurable: true, value: 229 });
    }, { capture: true, once: true }));
    await input.press('Enter'); await expect(form(page)).toBeVisible(); await expect(input).toHaveValue(name);
    const post = phases.post = (await imeEvents(page)).slice(postStart);
    expect(post.find(event => event.type === 'keydown')).toMatchObject({ key: 'Enter', keyCode: 229, isComposing: false, defaultPrevented: true });
    expect(post.some(event => event.type === 'submit')).toBe(false);
  } finally {
    await info.attach('held-metadata-ime-event-order', { body: JSON.stringify({ ...phases, events: await imeEvents(page) }), contentType: 'application/json' });
    await page.evaluate(() => (window as unknown as { leafspaceMetadataIme: ImeProbe }).leafspaceMetadataIme.stop());
  }
  await form(page).getByRole('textbox', { name: '备注', exact: true }).fill(note);
  await form(page).getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectHeldPanelChrome(page);
  const accessibility = await new AxeBuilder({ page }).include('[data-held-metadata-editor]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await info.attach('held-metadata-editor', { body: await page.screenshot(), contentType: 'image/png' });
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(form(page)).toHaveCount(0); await expect(edit(page)).toBeFocused();
  const saved = await save(page);
  expect(saved.heldPages[0]).toEqual({ ...before.heldPages[0], customName: name, note });
  expect({ currentPage: saved.currentPage, scale: saved.scale, windows: saved.windows, activeWindowId: saved.activeWindowId })
    .toEqual({ currentPage: before.currentPage, scale: before.scale, windows: before.windows, activeWindowId: before.activeWindowId });
  expect(await bytesHash(page)).toBe(sourceHash);
  await reopenRecent(page); await openPanel(page);
  await expect(page.getByRole('button', { name: '阅读第 8 页', exact: true })).toContainText(name);
  await edit(page).click(); await expect(form(page).getByRole('textbox', { name: '备注', exact: true })).toHaveValue(note);
  await form(page).getByRole('textbox', { name: '名称', exact: true }).fill('   ');
  await form(page).getByRole('button', { name: '保存', exact: true }).click();
  const reset = await save(page); expect(reset.heldPages[0].customName).toBeUndefined(); expect(reset.heldPages[0].note).toBe(note);
  await reopenRecent(page); await openPanel(page);
  await expect(page.getByRole('button', { name: '阅读第 8 页', exact: true })).toContainText('第 8 页');
  expect((await snapshots(page))[0].windows).toEqual(before.windows);
  expect(await bytesHash(page)).toBe(sourceHash);
});

test('editor Escape and book replacement never publish a draft or close its reference', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '打开第 8 页参考窗口', exact: true }).click();
  await openPanel(page); const before = await save(page);
  await edit(page).click();
  await form(page).getByRole('textbox', { name: '名称', exact: true }).fill('未保存的证明名称');
  await page.keyboard.press('Escape'); await expect(form(page)).toHaveCount(0);
  await expect(edit(page)).toBeFocused(); await expect(page.locator('[data-reader-pane]')).toHaveCount(2);
  if ((page.viewportSize()?.width ?? 0) < 1024) await expect(page.getByRole('button', { name: '夹页 1', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await edit(page).click(); await expect(form(page).getByRole('textbox', { name: '名称', exact: true })).toHaveValue('');
  await form(page).getByRole('textbox', { name: '备注', exact: true }).fill('不会写进另一本文档');
  // Import directly so this also interrupts an open compact drawer. The shared
  // import helper expects the main reader to be accessible throughout opening.
  await page.locator('input[type="file"]').setInputFiles(OTHER_BOOK_PATH);
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
  await expect(form(page)).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole('button', { name: '← 返回阅读', exact: true }).click();
  await expect(reader(page).locator('canvas').first()).toBeVisible();
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect.poll(async () => (await snapshots(page)).length).toBe(2);
  const both = await snapshots(page);
  const original = both.find(snapshot => snapshot.documentId === before.documentId)!;
  expect(original.heldPages).toEqual(before.heldPages); expect(original.windows).toEqual(before.windows);
  expect(both.find(snapshot => snapshot.documentId !== before.documentId)!.heldPages).toEqual([]);
});

test('short narrow held editors scroll without clipping their return control', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepare(page);
  const pinned = (await expectHeldPanelChrome(page))!;
  for (let attempt = 0; attempt < 2; attempt++) {
    await edit(page).click();
    await form(page).getByRole('textbox', { name: '备注', exact: true }).fill('短屏幕也能安心记录，再回到阅读');
    const cancel = form(page).getByRole('button', { name: '取消', exact: true });
    await cancel.scrollIntoViewIfNeeded();
    expect(await expectHeldPanelChrome(page)).toMatchObject({ top: pinned.top, mainTop: pinned.mainTop });
    await expect(cancel).toBeVisible();
    if (attempt === 0) await info.attach('short-held-editor-scroll', { body: await page.screenshot(), contentType: 'image/png' });
    await cancel.click(); await expect(form(page)).toHaveCount(0);
    await expectHeldPanelChrome(page);
  }
  await edit(page).click();
  await form(page).getByRole('textbox', { name: '名称', exact: true }).fill('短屏回看');
  const commit = form(page).getByRole('button', { name: '保存', exact: true });
  await commit.scrollIntoViewIfNeeded(); await expectHeldPanelChrome(page);
  await commit.click(); await expect(form(page)).toHaveCount(0);
  await expectHeldPanelChrome(page);
  await page.getByRole('button', { name: '← 返回阅读', exact: true }).click();
  await expect(reader(page)).toBeVisible();
  const scene = await save(page);
  expect(scene.heldPages[0].note).toBeUndefined(); expect(scene.heldPages[0].customName).toBe('短屏回看');
  expect(scene.currentPage).toBe(3);
});
