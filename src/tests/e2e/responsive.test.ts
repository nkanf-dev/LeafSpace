import { test, expect, BOOK_PATH, importBook, reader, quickFlip, snapshots, reopenRecent, expectQuickFlipThumbnail } from './helpers';
import { readFile } from 'node:fs/promises';
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

test('long recent filenames stay inside the library without squeezing its introduction', async ({ page }, testInfo) => {
  const fileName = `SyntheticLibraryLayout测试文档${'样例章节LongUnbrokenIdentifier0123456789'.repeat(12)}.pdf`;
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: await readFile(BOOK_PATH) });
  await expect(reader(page).locator('canvas').first()).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('header')).toContainText('第 2 页');
  await page.getByRole('button', { name: '回到书库', exact: true }).click();
  const recent = page.getByRole('button').filter({ hasText: fileName });
  await expect(recent).toBeEnabled();
  const savedSnapshots = await snapshots(page);
  const initialViewport = page.viewportSize()!;
  const sizes = [initialViewport, ...(initialViewport.width >= 1024 ? [{ width: 2048, height: 1204 }] : []), { width: 320, height: 720 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const importButton = page.getByRole('button', { name: '导入一本 PDF', exact: true });
    await importButton.scrollIntoViewIfNeeded();
    await expect(importButton).toBeInViewport();
    await capture(page, testInfo, `long-title-intro-${size.width}`);
    await recent.scrollIntoViewIfNeeded();
    await expect(recent).toBeInViewport();
    await capture(page, testInfo, `long-title-recent-${size.width}`);
    const geometry = await recent.evaluate((button) => {
      const panel = button.parentElement!.parentElement!;
      const grid = panel.parentElement!;
      const intro = grid.firstElementChild!;
      const title = button.querySelector<HTMLElement>('.truncate')!;
      const lineCount = (element: Element) => {
        const style = getComputedStyle(element);
        const contentHeight = element.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
          - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
        return contentHeight / parseFloat(style.lineHeight);
      };
      const bounds = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      };
      const overflow = [];
      // Document-only checks miss an overflowing nested library scroll area.
      for (let element: HTMLElement | null = button as HTMLElement; element; element = element.parentElement) {
        overflow.push({ tag: element.tagName, overflow: element.scrollWidth - element.clientWidth });
      }
      return { grid: bounds(grid), intro: bounds(intro), panel: bounds(panel), button: bounds(button), overflow,
        headingLines: lineCount(intro.querySelector('h1')!), importLines: lineCount(intro.querySelector('button')!),
        title: { text: title.textContent, width: title.clientWidth, scrollWidth: title.scrollWidth,
          textOverflow: getComputedStyle(title).textOverflow, whiteSpace: getComputedStyle(title).whiteSpace } };
    });
    await testInfo.attach(`library-geometry-${size.width}`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    expect(geometry.overflow.every(item => item.overflow <= 1), 'No library ancestor has horizontal scroll range').toBe(true);
    expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.panel.left);
    expect(geometry.button.right).toBeLessThanOrEqual(geometry.panel.right);
    expect(geometry.grid.left).toBeGreaterThanOrEqual(0);
    expect(geometry.grid.right).toBeLessThanOrEqual(size.width);
    expect(geometry.title).toMatchObject({ text: fileName, textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    expect(geometry.title.width).toBeGreaterThan(40);
    expect(geometry.title.scrollWidth).toBeGreaterThan(geometry.title.width);
    expect(geometry.headingLines).toBeCloseTo(1, 1);
    expect(geometry.importLines).toBeCloseTo(1, 1);
    if (size.width >= 768) {
      expect(geometry.intro.width / geometry.panel.width).toBeCloseTo(1.15 / 0.85, 2);
      expect(Math.abs(geometry.intro.top - geometry.panel.top)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(geometry.intro.width - geometry.panel.width)).toBeLessThanOrEqual(1);
      expect(geometry.panel.top).toBeGreaterThanOrEqual(geometry.intro.bottom - 1);
    }
  }
  // Resize and truncation must leave the original recent entry usable and saved.
  expect(await snapshots(page)).toEqual(savedSnapshots);
  await recent.focus();
  await page.keyboard.press('Enter');
  await expect(reader(page).locator('.react-pdf__Page[data-page-number="2"] canvas')).toBeVisible();
  await expect(page.locator('header')).toContainText(fileName);
  expect((await snapshots(page))[0]?.currentPage).toBe(2);
});

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
  if (testInfo.project.name === 'webkit') {
    const probe = await page.context().newPage();
    const results: Record<string, string | null> = {};
    for (const [name, style] of [['svg-hit-target', ''], ['button-hit-target', 'pointer-events:none']]) {
      await probe.setContent(`<input type="range" aria-label="Probe range" tabindex="0"><button aria-label="Probe next" tabindex="0"><svg style="${style}" width="20" height="20" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" fill="none" stroke="black" /></svg></button>`);
      await probe.getByRole('button', { name: 'Probe next' }).click();
      await probe.getByRole('button', { name: 'Probe next' }).focus();
      await probe.keyboard.press('Shift+Tab');
      results[name] = await probe.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
    }
    await testInfo.attach('webkit-svg-hit-target-probe', { body: JSON.stringify(results), contentType: 'application/json' });
    await probe.close();
  }
  await page.bringToFront();
  const nextPage = page.getByRole('button', { name: '下一页', exact: true });
  const timeline = page.getByRole('slider', { name: '跳转到页码' });
  await nextPage.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(timeline).toBeFocused();
  await page.keyboard.press('Tab');
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
