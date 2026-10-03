import AxeBuilder from '@axe-core/playwright';
import { test, expect, importBook, navigateTo, snapshots, expectMainPage } from './helpers';
import type { Page } from '@playwright/test';

async function installFault(page: Page) {
  await page.addInitScript(() => {
    const state = { restore: false, asset: false, reads: 0, writes: 0, assets: 0 };
    Object.assign(window, { leafspaceRecoveryFault: state });
    const get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'workspaces') {
        state.reads++;
        if (state.restore) throw new DOMException('Synthetic recovery read failure', 'UnknownError');
      }
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'workspaces') state.writes++;
      if (this.name === 'books') {
        state.assets++;
        if (state.asset) throw new DOMException('Synthetic recovery quota', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
}
async function fault(page: Page, changes: Partial<{ restore: boolean; asset: boolean }> = {}) {
  return page.evaluate(changes => {
    const state = (window as unknown as { leafspaceRecoveryFault: { restore: boolean; asset: boolean; reads: number; writes: number; assets: number } }).leafspaceRecoveryFault;
    Object.assign(state, changes); return state;
  }, changes);
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('dismissed restoration has a direct keyboard recovery path without overwriting the saved workspace', async ({ page }, info) => {
  await installFault(page); await page.goto('/'); await importBook(page); await navigateTo(page, 7);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const original = (await snapshots(page))[0];
  await page.reload(); await fault(page, { restore: true });
  await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
  const alert = page.getByRole('alert', { name: '问题详情' });
  const details = page.getByRole('button', { name: '查看问题', exact: true });
  await expect(alert).toContainText('Synthetic recovery read failure'); await expectMainPage(page, 1);
  const before = await fault(page);
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  for (const key of ['Space', 'Enter']) {
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
    await expect(details).toBeFocused(); await expect(details).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press(key); await expect(alert).toBeFocused();
    await page.keyboard.press('Space'); await expect(page.getByRole('dialog', { name: '速翻视图' })).toHaveCount(0);
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '重试恢复', exact: true })).toBeFocused();
  }
  expect(await fault(page)).toEqual(before); expect((await snapshots(page))[0]).toEqual(original);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
    await page.getByRole('button', { name: '回到书库', exact: true }).click();
    await expect(alert).toContainText('上次阅读现场尚未恢复');
    await expect(page.getByRole('button', { name: '重试恢复', exact: true })).toBeVisible();
  }
  expect(await fault(page)).toEqual(before); expect((await snapshots(page))[0]).toEqual(original);
  await info.attach('restore-guidance-rediscovered', { body: await page.screenshot(), contentType: 'image/png' });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(details).toBeFocused(); await noHorizontalOverflow(page);
  expect((await details.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await info.attach('restore-guidance-dismissed-320', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Enter'); await expect(alert).toBeFocused(); await noHorizontalOverflow(page);
  const message = await page.locator('#workspace-problem-message').boundingBox();
  const recovery = await page.getByRole('button', { name: '重试恢复', exact: true }).boundingBox();
  expect(message!.width).toBeGreaterThanOrEqual(286);
  expect(recovery!.y).toBeGreaterThanOrEqual(message!.y + message!.height);
  await expect(alert).toHaveCSS('outline-offset', '-3px');
  await info.attach('restore-guidance-focused-320', { body: await page.screenshot(), contentType: 'image/png' });
  const accessibility = await new AxeBuilder({ page }).include('#workspace-problem-guidance').analyze();
  expect(accessibility.violations).toEqual([]);
  await fault(page, { restore: false });
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expectMainPage(page, 7); await expect(alert).toHaveCount(0); await expect(details).toHaveCount(0);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await info.attach('restore-guidance-recovered-320', { body: await page.screenshot(), contentType: 'image/png' });
});

test('dismissed PDF quota guidance reopens without retrying until its explicit recovery action', async ({ page }, info) => {
  await installFault(page); await page.goto('/'); await fault(page, { asset: true }); await importBook(page);
  const alert = page.getByRole('alert', { name: '问题详情' });
  const details = page.getByRole('button', { name: '查看问题', exact: true });
  await expect(alert).toContainText('PDF 尚未保存到本机'); await navigateTo(page, 4);
  const before = await fault(page);
  await page.getByRole('button', { name: '关闭提示', exact: true }).click(); await expect(details).toBeFocused();
  await page.keyboard.press('Enter'); await expect(alert).toBeFocused();
  expect(await fault(page)).toEqual(before); expect(await snapshots(page)).toEqual([]);
  await info.attach('quota-guidance-rediscovered', { body: await page.screenshot(), contentType: 'image/png' });
  await fault(page, { asset: false }); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0); await expect(details).toHaveCount(0);
  expect((await snapshots(page))[0].currentPage).toBe(4);
});

test('an idle-library import problem remains reachable after its guidance is dismissed', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'not-a-pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic non-PDF') });
  await expect(page.getByRole('alert', { name: '问题详情' })).toContainText('请选择 PDF 文件');
  const details = page.getByRole('button', { name: '查看问题', exact: true });
  await page.getByRole('button', { name: '关闭提示', exact: true }).click(); await expect(details).toBeFocused();
  await page.keyboard.press('Space'); await expect(page.getByRole('alert')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '重新导入', exact: true })).toBeFocused();
  expect(await snapshots(page)).toEqual([]); await noHorizontalOverflow(page);
});
