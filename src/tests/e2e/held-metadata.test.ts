import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, importBook, navigateTo, snapshots, reopenRecent, reader, BOOK_PATH, OTHER_BOOK_PATH } from './helpers';

const sourceHash = createHash('sha256').update(readFileSync(BOOK_PATH)).digest('hex');
const form = (page: Page) => page.getByRole('form', { name: '编辑第 8 页名称和备注', exact: true });
const edit = (page: Page) => page.getByRole('button', { name: '编辑第 8 页名称和备注', exact: true });
async function openPanel(page: Page) {
  const toggle = page.getByRole('button', { name: '夹页 1', exact: true });
  if ((page.viewportSize()?.width ?? 0) < 1024 && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
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

test('held names and notes keep the reading scene and original PDF intact through saved reopen', async ({ page }, info) => {
  await prepare(page);
  const before = await save(page);
  await edit(page).click(); await expect(form(page).getByRole('textbox', { name: '名称', exact: true })).toBeFocused();
  const name = '定义与证明' + 'a'.repeat(75);
  const note = '对照第二章的图示\n回看这个定义与证明';
  const input = form(page).getByRole('textbox', { name: '名称', exact: true });
  await input.dispatchEvent('compositionstart'); await input.fill(name);
  await input.press('Enter'); await expect(form(page)).toBeVisible();
  await input.dispatchEvent('compositionend');
  // Event-contract check for IME engines that report Enter after compositionend.
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, bubbles: true, cancelable: true });
  await expect(form(page)).toBeVisible();
  await form(page).getByRole('textbox', { name: '备注', exact: true }).fill(note);
  await form(page).getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
