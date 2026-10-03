import { test, expect, importBook, reader, navigateTo, snapshots, reopenRecent, expectMainPage } from './helpers';
import type { Page } from '@playwright/test';

async function freezeDebounce(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
}
async function requestReload(page: Page, choice: 'accept' | 'dismiss') {
  const dialogPromise = page.waitForEvent('dialog');
  const loaded = choice === 'accept' ? page.waitForEvent('load').then(() => true, () => false) : null;
  // Request navigation without waiting for a load that dismissal deliberately cancels.
  const requested = page.evaluate(() => location.reload()).catch(() => undefined);
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog[choice](); await requested; if (loaded) expect(await loaded).toBe(true);
}
async function cleanReload(page: Page) {
  const dialogs: string[] = [];
  const unexpected = async (dialog: import('@playwright/test').Dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); };
  page.on('dialog', unexpected);
  try { await page.reload(); } finally { page.off('dialog', unexpected); }
  expect(dialogs).toEqual([]);
}
async function installFault(page: Page, fault: 'asset' | 'restore') {
  await page.addInitScript(({ fault }) => {
    const state = { enabled: true }; Object.assign(window, { leafspaceExitFault: state });
    const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.put = function (...args) {
      if (state.enabled && fault === 'asset' && this.name === 'books') throw new DOMException('Synthetic exit quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
    IDBObjectStore.prototype.get = function (...args) {
      if (state.enabled && fault === 'restore' && this.name === 'workspaces') throw new DOMException('Synthetic exit restore failure', 'UnknownError');
      return get.apply(this, args);
    };
  }, { fault });
}
async function recover(page: Page) {
  await page.evaluate(() => { (window as unknown as { leafspaceExitFault: { enabled: boolean } }).leafspaceExitFault.enabled = false; });
}

test('native reload cancellation preserves a new reading change and confirmed saving removes the warning', async ({ page }, info) => {
  await page.clock.install();
  await page.goto('/'); await importBook(page);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await reader(page).focus(); await freezeDebounce(page);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('header')).toContainText('第 2 页');
  await requestReload(page, 'dismiss');
  await expect(page.locator('header')).toContainText('第 2 页');
  expect((await snapshots(page))[0].currentPage).toBe(1);
  await page.clock.resume();
  await expect.poll(async () => (await snapshots(page))[0].currentPage).toBe(2);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await expectMainPage(page, 2);
  await info.attach('cancelled-exit-saved-recovery', { body: await page.screenshot(), contentType: 'image/png' });
  await cleanReload(page); await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click(); await expectMainPage(page, 2);
});

test('explicitly accepting the native warning permits leaving the synthetic unsaved revision', async ({ page }) => {
  await page.clock.install();
  await page.goto('/'); await importBook(page);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await reader(page).focus(); await freezeDebounce(page);
  await page.keyboard.press('ArrowRight');
  await requestReload(page, 'accept');
  await page.clock.resume();
  await expect(page.getByRole('heading', { name: '页境阅读', exact: true })).toBeVisible();
  // Leaving may start a hidden-time save. Assert recovery of what actually became
  // durable, rather than requiring an unsaved change to be lost.
  const durablePage = (await snapshots(page))[0].currentPage;
  expect([1, 2]).toContain(durablePage);
  await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
  await expectMainPage(page, durablePage);
});

test('dismissing a PDF quota alert does not dismiss the native exit warning', async ({ page }, info) => {
  await installFault(page, 'asset'); await page.goto('/'); await importBook(page);
  await expect(page.getByRole('alert')).toContainText('刷新或关闭页面可能丢失');
  await navigateTo(page, 4);
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await requestReload(page, 'dismiss');
  await expectMainPage(page, 4); expect(await snapshots(page)).toEqual([]);
  await recover(page);
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await info.attach('quota-exit-warning-recovered', { body: await page.screenshot(), contentType: 'image/png' });
  await cleanReload(page); await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click(); await expectMainPage(page, 4);
});

test('an untouched failed restore can reload, while new reading changes warn without overwriting its snapshot', async ({ page }) => {
  await page.goto('/'); await importBook(page); await navigateTo(page, 7);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const original = (await snapshots(page))[0];
  await installFault(page, 'restore'); await reopenRecent(page);
  await expect(page.getByRole('alert')).toContainText('Synthetic exit restore failure');
  await expectMainPage(page, 1);
  await cleanReload(page); await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic exit restore failure');
  await expectMainPage(page, 1);
  await navigateTo(page, 3); await requestReload(page, 'dismiss');
  await expectMainPage(page, 3); expect((await snapshots(page))[0]).toEqual(original);
  await recover(page);
  await page.getByRole('button', { name: '重试恢复', exact: true }).click();
  await expectMainPage(page, 7);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await cleanReload(page);
});
