import { test, expect, importBook, reader, quickFlip, snapshots, reopenRecent, expectQuickFlipThumbnail } from './helpers';
import type { Page, TestInfo } from '@playwright/test';

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${testInfo.project.name}-${name}`, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

async function expectNoDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function showHeldPages(page: Page) {
  const toggle = page.getByRole('button', { name: /^夹页 \d+$/ });
  if (await toggle.isVisible()) await toggle.click();
}

test('welcome and reader remain usable at the project viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'welcome');
  await importBook(page);
  await expect(reader(page)).toBeVisible();
  await expect.poll(async () => reader(page).evaluate((region) => {
    const canvas = region.querySelector('canvas');
    return !!canvas && canvas.getBoundingClientRect().width <= region.getBoundingClientRect().width;
  }), { message: 'Default PDF width fits its reader pane' }).toBe(true);
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('header')).toContainText('第 2 页');
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'reader');
  await page.bringToFront();
  const nextPage = page.getByRole('button', { name: '下一页', exact: true });
  const timeline = page.getByRole('slider', { name: '跳转到页码' });
  let nativeSequentialTab = true;
  if (testInfo.project.name === 'webkit') {
    const probe = await page.context().newPage();
    await probe.setContent('<input aria-label="Probe number" value="2"><input type="range" aria-label="Probe range" tabindex="0"><button aria-label="Probe next" tabindex="0">Next</button>');
    await probe.bringToFront();
    await probe.getByRole('button', { name: 'Probe next' }).focus();
    await probe.keyboard.press('Shift+Tab');
    const state = await probe.evaluate(() => ({ documentFocused: document.hasFocus(), active: document.activeElement?.getAttribute('aria-label') }));
    nativeSequentialTab = state.active === 'Probe range';
    await testInfo.attach('webkit-app-independent-tab-probe', { body: JSON.stringify(state), contentType: 'application/json' });
    await probe.close();
    await page.bringToFront();
  }
  if (!nativeSequentialTab) {
    // Native WebKit tab traversal depends on Full Keyboard Access settings
    // (https://github.com/microsoft/playwright/issues/5609). Verify the app's
    // real keyboard activation contract without assuming the runner's OS setting.
    await timeline.focus();
    await timeline.press('ArrowRight');
    await expect(page.locator('header')).toContainText('第 3 页');
    await timeline.press('ArrowLeft');
    await expect(page.locator('header')).toContainText('第 2 页');
    await nextPage.focus();
    await nextPage.press('Space');
    await expect(page.locator('header')).toContainText('第 3 页');
    await page.getByRole('button', { name: '上一页', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('header')).toContainText('第 2 页');
    await nextPage.focus();
  } else {
    await nextPage.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(timeline).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(nextPage).toBeFocused();
  await expect.poll(() => nextPage.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
  await capture(page, testInfo, 'keyboard-focus');

  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect(quickFlip(page)).toBeVisible();
  await expect(quickFlip(page).getByRole('button', { name: '关闭速翻', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await expectQuickFlipThumbnail(page, 2);
  await capture(page, testInfo, 'quick-flip');
  await quickFlip(page).getByRole('button', { name: '预览下一页', exact: true }).click();
  await quickFlip(page).getByRole('button', { name: '阅读此页', exact: true }).click();
  await expect(quickFlip(page)).toHaveCount(0);
  await expect(page.locator('header')).toContainText('第 3 页');

  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await showHeldPages(page);
  await expect(page.getByRole('button', { name: '打开第 3 页参考窗口', exact: true })).toBeInViewport();
  await capture(page, testInfo, 'held-pages');
  await page.getByRole('button', { name: '打开第 3 页参考窗口', exact: true }).click();
  const reference = page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true });
  await expect(reference.locator('canvas')).toBeVisible();
  await expect.poll(() => reference.evaluate((region) => {
    const canvas = region.querySelector('canvas');
    return !!canvas && canvas.getBoundingClientRect().width <= region.getBoundingClientRect().width;
  }), { message: 'Default PDF width fits its reference pane' }).toBe(true);
  await expect(page.locator('[data-floating-window]').getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'comparison');
  await page.locator('[data-floating-window]').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('[data-floating-window]')).toHaveCount(0);
});

test('autosave and recent restore work without the desktop Save button', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await expect.poll(async () => (await snapshots(page)).some((snapshot) => snapshot.currentPage === 2 && snapshot.heldPages.length === 1)).toBe(true);
  await reopenRecent(page);
  await expect(page.locator('header')).toContainText('第 2 页');
  await showHeldPages(page);
  await expect(page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true })).toBeVisible();
});

test('import errors are visible, dismissible, and leave a usable import control', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新导入', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'invalid-pdf');
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
});

test('Escape dismisses a compact held-page drawer before its comparison', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await showHeldPages(page);
  await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  const drawerToggle = page.getByRole('button', { name: /^夹页 \d+$/ });
  if (await drawerToggle.isVisible()) {
    await drawerToggle.click();
    await expect(page.getByRole('button', { name: '← 返回阅读', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(drawerToggle).toBeFocused();
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-floating-window]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reader(page)).toBeVisible();
  await expect(reader(page)).toBeFocused();
});


test('fit-width is a starting scale and still allows intentional zoom overflow', async ({ page }) => {
  await page.goto('/');
  await importBook(page);
  const canvasWidth = () => reader(page).locator('canvas').evaluate((canvas) => canvas.getBoundingClientRect().width);
  const readerWidth = await reader(page).evaluate((region) => region.getBoundingClientRect().width);
  await expect.poll(canvasWidth).toBeLessThanOrEqual(readerWidth);
  const initialWidth = await canvasWidth();
  for (let index = 0; index < 7; index++) await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(canvasWidth).toBeGreaterThan(initialWidth);
  await expect.poll(canvasWidth).toBeGreaterThan(readerWidth);
  await expectNoDocumentOverflow(page);
});

test('compact 320px header keeps import and save controls reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeInViewport();
  await importBook(page);
  await expect(page.getByRole('button', { name: '保存现场', exact: true })).toBeInViewport();
  await expectNoDocumentOverflow(page);
  await capture(page, testInfo, 'compact-header');
});

test('short landscape Quick Flip retains its preview and all primary actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await importBook(page);
  await page.getByRole('button', { name: /^速翻/ }).click();
  await expectQuickFlipThumbnail(page, 1);
  const dialog = quickFlip(page);
  for (const label of ['关闭速翻', '阅读此页', '夹住此页', '打开参考窗']) {
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeInViewport();
  }
  await expect(dialog.getByRole('button', { name: '选择第 1 页', exact: true }).locator('img')).toBeInViewport({ ratio: 0.95 });
  await capture(page, testInfo, 'short-landscape-quick-flip');
});

test('mobile page tabs keep five references reachable and Quick Flip new-window focus survives dismissal', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await importBook(page);
  for (let number = 2; number <= 5; number++) {
    await page.getByRole('region', { name: /阅读区/ }).focus();
    await page.keyboard.press('Space');
    await expect(quickFlip(page)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('n');
    const ref = page.getByRole('region', { name: `参考阅读区，第 ${number} 页`, exact: true });
    await expect(ref.locator('canvas')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '打开的页面' }).getByRole('button', { name: `参考 · ${number}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  const tabs = page.getByRole('navigation', { name: '打开的页面' });
  await expect(tabs.getByRole('button')).toHaveCount(5);
  await tabs.getByRole('button', { name: '主视角 · 1', exact: true }).click();
  await expect(reader(page).locator('canvas')).toBeVisible();
  await tabs.getByRole('button', { name: '参考 · 3', exact: true }).click();
  await expect(page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
  await capture(page, testInfo, 'mobile-five-window-switcher');
  const activeRegion = page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true });
  const activePane = page.locator('[data-reader-pane][data-mobile-active="true"]').filter({ has: activeRegion });
  for (let index = 0; index < 5; index++) await activePane.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(() => activeRegion.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(150);
  await activeRegion.evaluate(el => el.scrollTo(150, 300));
  await expect.poll(async () => {
    const saved = (await snapshots(page))[0];
    return Math.abs((saved?.windows.find(win => win.id === saved.activeWindowId)?.viewport?.scrollTop ?? -999) - 300);
  }).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '保存现场', exact: true }).click();
  await expect.poll(async () => (await snapshots(page))[0]?.windows.length).toBe(5);
  await page.reload();
  await page.getByRole('button', { name: /leafspace-12-pages\.pdf/ }).click();
  await expect(page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
  await expect(tabs.getByRole('button', { name: '参考 · 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => activeRegion.evaluate(el => Math.abs(el.scrollLeft - 150))).toBeLessThanOrEqual(1);
  await expect.poll(() => activeRegion.evaluate(el => Math.abs(el.scrollTop - 300))).toBeLessThanOrEqual(1);
  await capture(page, testInfo, 'mobile-five-window-scroll-restored');
  await expectNoDocumentOverflow(page);
});
