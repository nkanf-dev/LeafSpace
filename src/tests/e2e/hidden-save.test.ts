import { test, expect, importBook, reader, navigateTo, snapshots, reopenRecent, expectMainPage } from './helpers';
import type { Page } from '@playwright/test';

// Lifecycle event contract with the runtime kept alive, not a mobile process-kill simulation.
async function visibility(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
async function freezeDebounce(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
}
async function installFault(page: Page) {
  await page.addInitScript(() => {
    const state = { failSave: false, failRestore: false, puts: 0 };
    Object.assign(window, { leafspaceHiddenFault: state });
    const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'workspaces') {
        state.puts++;
        if (state.failSave) throw new DOMException('Synthetic hidden save failure', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'workspaces' && state.failRestore) throw new DOMException('Synthetic hidden restore failure', 'UnknownError');
      return get.apply(this, args);
    };
  });
}
async function fault(page: Page, changes: Partial<{ failSave: boolean; failRestore: boolean; puts: number }> = {}) {
  return page.evaluate(changes => {
    const state = (window as unknown as { leafspaceHiddenFault: { failSave: boolean; failRestore: boolean; puts: number } }).leafspaceHiddenFault;
    Object.assign(state, changes); return state;
  }, changes);
}

test('hidden lifecycle starts the pending save while the visible debounce remains frozen', async ({ page }, info) => {
  await page.clock.install(); await page.goto('/'); await importBook(page);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await reader(page).focus(); await freezeDebounce(page); await page.keyboard.press('ArrowRight');
  await expect(page.locator('header')).toContainText('第 2 页');
  expect((await snapshots(page))[0].currentPage).toBe(1);
  await visibility(page, true);
  await expect.poll(async () => (await snapshots(page))[0].currentPage).toBe(2);
  const durable = (await snapshots(page))[0];
  await visibility(page, true); await visibility(page, false);
  await page.clock.resume();
  await expectMainPage(page, 2); await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  expect((await snapshots(page))[0]).toEqual(durable);
  await reopenRecent(page); await expectMainPage(page, 2);
  await info.attach('hidden-save-reopened-reader', { body: await page.screenshot(), contentType: 'image/png' });
});

test('failed hidden saving remains explicit and does not retry on visibility or alert dismissal', async ({ page }, info) => {
  await installFault(page); await page.clock.install(); await page.goto('/'); await importBook(page);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await fault(page, { failSave: true, puts: 0 });
  await reader(page).focus(); await freezeDebounce(page); await page.keyboard.press('ArrowRight');
  await visibility(page, true);
  await expect(page.getByRole('alert')).toContainText('Synthetic hidden save failure');
  expect((await fault(page)).puts).toBe(1);
  await visibility(page, false); await visibility(page, true);
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await visibility(page, true);
  expect((await fault(page)).puts).toBe(1);
  expect((await snapshots(page))[0].currentPage).toBe(1);
  await fault(page, { failSave: false }); await page.clock.resume();
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  expect((await snapshots(page))[0].currentPage).toBe(2);
  expect((await fault(page)).puts).toBe(2);
  await visibility(page, false); await reopenRecent(page); await expectMainPage(page, 2);
  await info.attach('hidden-save-explicit-recovery', { body: await page.screenshot(), contentType: 'image/png' });
});

test('hidden lifecycle cannot overwrite an unread previous workspace after its alert is dismissed', async ({ page }) => {
  await installFault(page); await page.clock.install(); await page.goto('/'); await importBook(page);
  await navigateTo(page, 7); await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const original = (await snapshots(page))[0];
  await page.reload(); await fault(page, { failRestore: true, puts: 0 });
  await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic hidden restore failure');
  await expectMainPage(page, 1);
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await reader(page).focus(); await freezeDebounce(page); await page.keyboard.press('ArrowRight');
  await visibility(page, true); await visibility(page, false); await visibility(page, true);
  expect((await fault(page)).puts).toBe(0);
  expect((await snapshots(page))[0]).toEqual(original);
  await fault(page, { failRestore: false }); await page.clock.resume();
  // A blocked library transition resurfaces the dismissed recovery action.
  await page.getByRole('button', { name: '回到书库', exact: true }).click();
  await page.getByRole('button', { name: '重试恢复', exact: true }).click();
  await expectMainPage(page, 7);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await visibility(page, false);
  await reopenRecent(page); await expectMainPage(page, 7);
});
