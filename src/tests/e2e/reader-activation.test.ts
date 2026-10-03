import { test, expect, importBook, reader, snapshots, expectMainPage, holdCurrentPage, quickFlip } from './helpers';
import type { Page } from '@playwright/test';

async function installCounter(page: Page) {
  await page.addInitScript(() => {
    const state = { count: 0, pages: [] as number[] };
    Object.assign(window, { leafspaceActivationWrites: state });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'workspaces') { state.count++; state.pages.push((args[0] as { currentPage: number }).currentPage); }
      return put.apply(this, args);
    };
  });
}
async function writes(page: Page, reset = false) {
  return page.evaluate(reset => {
    const state = (window as unknown as { leafspaceActivationWrites: { count: number; pages: number[] } }).leafspaceActivationWrites;
    if (reset) { state.count = 0; state.pages = []; }
    return state;
  }, reset);
}
async function freezeSettled(page: Page) {
  // Install the clock before navigation; advance existing rendering/focus work
  // before establishing the baseline and resetting the operation counter.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await writes(page, true);
}
async function prepare(page: Page) {
  await installCounter(page); await page.clock.install(); await page.goto('/'); await importBook(page);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await reader(page).focus(); await freezeSettled(page);
}

test('motionless reader input and toolbar focus leave the durable snapshot and savedAt unchanged', async ({ page }, info) => {
  await prepare(page); const original = (await snapshots(page))[0];
  for (let index = 0; index < 10; index++) {
    await reader(page).click({ position: { x: 100, y: 100 } }); await page.clock.runFor(600);
  }
  await page.getByRole('button', { name: '选择文字', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '拖动页面', exact: true })).toBeFocused();
  await page.clock.runFor(600);
  if (info.project.use.hasTouch) {
    await reader(page).tap({ position: { x: 100, y: 100 } }); await page.clock.runFor(600);
  }
  expect(await writes(page)).toEqual({ count: 0, pages: [] }); expect((await snapshots(page))[0]).toEqual(original);
  await page.clock.resume(); await expectMainPage(page, 1);
  await info.attach('motionless-reader-saved-context', { body: await page.screenshot(), contentType: 'image/png' });
});

test('repeated no-op clicks do not restart the genuine page-change debounce', async ({ page }) => {
  await prepare(page); await page.keyboard.press('ArrowRight');
  await expect(page.locator('header')).toContainText('第 2 页');
  for (let index = 0; index < 4; index++) {
    await page.clock.runFor(100); await reader(page).click({ position: { x: 100, y: 100 } });
  }
  await page.clock.runFor(99); expect((await writes(page)).count).toBe(0);
  await page.clock.runFor(1);
  await expect.poll(async () => (await snapshots(page))[0].currentPage).toBe(2);
  expect(await writes(page)).toEqual({ count: 1, pages: [2] });
  for (let index = 0; index < 6; index++) {
    await page.clock.runFor(100); await reader(page).click({ position: { x: 100, y: 100 } });
  }
  await page.clock.runFor(600); expect(await writes(page)).toEqual({ count: 1, pages: [2] });
  await page.clock.resume(); await expectMainPage(page, 2);
});

test('real reference activation and Enter still save while cancelled preview focus does not', async ({ page }, info) => {
  test.skip(['mobile', 'mobile-webkit'].includes(info.project.name), 'Concurrent-pane focus here; compact tab switching remains covered by responsive tests');
  await installCounter(page); await page.clock.install(); await page.goto('/'); await importBook(page);
  await holdCurrentPage(page, 1); await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
  const reference = page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true });
  await expect(reference.locator('canvas')).toBeVisible();
  const referenceId = await reference.locator('xpath=ancestor::*[@data-window-id][1]').getAttribute('data-window-id');
  await reader(page).focus(); await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await freezeSettled(page);
  await reference.focus(); await page.clock.runFor(500);
  await expect.poll(async () => (await snapshots(page))[0].activeWindowId).toBe(referenceId);
  expect((await writes(page)).count).toBe(1);
  const activated = (await snapshots(page))[0];
  await page.keyboard.press('Space'); await expect(quickFlip(page)).toBeVisible();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape'); await page.clock.runFor(600);
  await expect(reference).toBeFocused(); expect((await snapshots(page))[0]).toEqual(activated);
  expect((await writes(page)).count).toBe(1);
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.clock.runFor(600);
  await expect.poll(async () => (await snapshots(page))[0].windows.find(win => win.id === referenceId)?.pageNumber).toBe(2);
  expect((await writes(page)).count).toBe(2); expect((await snapshots(page))[0].currentPage).toBe(1);
  await page.clock.resume();
  await expect(page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true }).locator('canvas')).toBeVisible();
  await info.attach('reference-activation-and-confirmed-navigation', { body: await page.screenshot(), contentType: 'image/png' });
});
