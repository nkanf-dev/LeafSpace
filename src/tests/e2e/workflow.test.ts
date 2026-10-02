import { test, expect, importBook, reader, expectMainPage, navigateTo, quickFlip, openQuickFlip, holdCurrentPage, expectQuickFlipThumbnail } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await importBook(page);
});

test.describe('Reader navigation and zoom', () => {
  test('arrow navigation and timeline respect both document boundaries', async ({ page }) => {
    await reader(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expectMainPage(page, 1);
    await page.keyboard.press('ArrowRight');
    await expectMainPage(page, 2);
    const timeline = page.getByRole('slider', { name: '跳转到页码' });
    await timeline.focus();
    await page.keyboard.press('End');
    await expectMainPage(page, 12);
    await reader(page).focus();
    await page.keyboard.press('ArrowRight');
    await expectMainPage(page, 12);
    await timeline.focus();
    await page.keyboard.press('Home');
    await expectMainPage(page, 1);
  });

  test('named zoom controls and selection modes work with the keyboard', async ({ page }) => {
    const zoomIn = page.getByRole('button', { name: '放大', exact: true });
    await zoomIn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('120%', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '缩小', exact: true }).click();
    await expect(page.getByText('96%', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '选择文字', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择文字', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '拖动页面', exact: true }).click();
    await expect(page.getByRole('button', { name: '拖动页面', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectMainPage(page, 1);
  });

  test('Space on an import button retains native activation', async ({ page }) => {
    await page.getByRole('button', { name: '导入书籍', exact: true }).focus();
    const fileChooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await fileChooser;
    await expect(quickFlip(page)).toHaveCount(0);
    await expectMainPage(page, 1);
  });
});

test.describe('Quick Flip selection and keyboard isolation', () => {
  test('Escape cancels selection without moving the reader and returns focus', async ({ page }) => {
    await navigateTo(page, 3);
    await openQuickFlip(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(quickFlip(page).getByRole('button', { name: '选择第 5 页', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('header')).toContainText('第 3 页');
    await page.keyboard.press('Escape');
    await expect(quickFlip(page)).toHaveCount(0);
    await expectMainPage(page, 3);
    await expect(reader(page)).toBeFocused();
  });

  test('Enter commits a selected page and repeated openings reset to the actual reader page', async ({ page }) => {
    for (const target of [4, 8, 2]) {
      await openQuickFlip(page);
      await quickFlip(page).getByRole('button', { name: `选择第 ${target} 页`, exact: true }).click();
      await expectQuickFlipThumbnail(page, target);
      await page.keyboard.press('Enter');
      await expect(quickFlip(page)).toHaveCount(0);
      await expectMainPage(page, target);
      await openQuickFlip(page);
      await expect(quickFlip(page).getByRole('button', { name: `选择第 ${target} 页`, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
    }
  });

  test('holding an arrow enters accelerated timeline, then settles without committing', async ({ page }) => {
    await openQuickFlip(page);
    await page.keyboard.down('ArrowRight');
    try {
      await expect(quickFlip(page).getByText('时间轴视图', { exact: true })).toBeVisible();
    } finally {
      await page.keyboard.up('ArrowRight');
    }
    await expect(quickFlip(page).getByText('时间轴视图', { exact: true })).toHaveCount(0);
    await expect(quickFlip(page).getByRole('button', { pressed: true })).toHaveCount(1);
    await expect(page.locator('header')).toContainText('第 1 页');
    await page.keyboard.press('Escape');
    await expectMainPage(page, 1);
  });

  test('a repeated Space keydown does not reopen or dismiss the overlay', async ({ page }) => {
    await reader(page).focus();
    await page.keyboard.down('Space');
    await expect(quickFlip(page)).toBeVisible();
    await page.keyboard.down('Space'); // Playwright marks successive keydowns as repeat.
    await expect(quickFlip(page)).toBeVisible();
    await page.keyboard.up('Space');
    await page.keyboard.press('Space');
    await expect(quickFlip(page)).toHaveCount(0);
  });

  test('modal focus stays within Quick Flip while tabbing', async ({ page }) => {
    await openQuickFlip(page);
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press(index % 3 === 0 ? 'Shift+Tab' : 'Tab');
      expect(await quickFlip(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(reader(page)).toBeFocused();
  });

  test('can hold and release a preview page without changing the reading position', async ({ page }) => {
    await openQuickFlip(page);
    await quickFlip(page).getByRole('button', { name: '选择第 5 页', exact: true }).click();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('button', { name: '打开第 5 页参考窗口', exact: true, includeHidden: true })).toBeAttached();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: '打开第 5 页参考窗口', exact: true, includeHidden: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expectMainPage(page, 1);
  });
});

test.describe('Held pages and comparison windows', () => {
  test('holding twice keeps one reference and keyboard activation opens a closable window', async ({ page }) => {
    await navigateTo(page, 3);
    await holdCurrentPage(page, 3);
    await page.keyboard.press('ArrowUp');
    const held = page.getByRole('button', { name: '打开第 3 页参考窗口', exact: true });
    await expect(held).toHaveCount(1);
    await held.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
    await page.locator('[data-floating-window]').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
    await expect(held).toBeVisible();
    await expectMainPage(page, 3);
  });

  test('a reference can navigate independently, dock, swap, float, and close', async ({ page }) => {
    await navigateTo(page, 2);
    await holdCurrentPage(page, 2);
    await page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true }).click();
    await page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
    await expectMainPage(page, 2);
    await page.locator('[data-floating-window]').getByRole('button', { name: '吸附', exact: true }).click();
    await expect(page.getByRole('separator', { name: '调整主窗口与分栏宽度' })).toBeVisible();
    await page.getByRole('button', { name: '交换', exact: true }).click();
    await expectMainPage(page, 3);
    await expect(page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '浮动', exact: true }).click();
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
    await page.locator('[data-floating-window]').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
    await expectMainPage(page, 3);
  });

  test('removing a held page closes its comparison only when requested', async ({ page }) => {
    await holdCurrentPage(page, 1);
    await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
    await page.getByRole('button', { name: '移除第 1 页夹页', exact: true }).click();
    await page.getByRole('button', { name: '同时关闭', exact: true }).click();
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true })).toHaveCount(0);
    await expectMainPage(page, 1);
  });
});

test.describe('Held-page navigation contracts and Escape priority', () => {
  test('single-click reads a held page in the main reader without opening a comparison', async ({ page }) => {
    await holdCurrentPage(page, 1);
    await navigateTo(page, 4);
    await page.getByRole('button', { name: '阅读第 1 页', exact: true }).click();
    await expectMainPage(page, 1);
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
  });

  test('single-click reads a held page in the focused comparison and preserves the main page', async ({ page }) => {
    await navigateTo(page, 2);
    await holdCurrentPage(page, 2);
    await navigateTo(page, 5);
    await holdCurrentPage(page, 5);
    await navigateTo(page, 8);
    await page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true }).click();
    await page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true }).focus();
    await page.getByRole('button', { name: '阅读第 5 页', exact: true }).click();
    await expect(page.getByRole('region', { name: '参考阅读区，第 5 页', exact: true }).locator('canvas')).toBeVisible();
    await expectMainPage(page, 8);
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  });

  test('double-click opens a comparison for a held page', async ({ page }) => {
    await navigateTo(page, 3);
    await holdCurrentPage(page, 3);
    await navigateTo(page, 6);
    await page.getByRole('button', { name: '阅读第 3 页', exact: true }).dblclick();
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '参考阅读区，第 3 页', exact: true }).locator('canvas')).toBeVisible();
  });

  test('Escape closes the top comparison first and never closes the main reader', async ({ page }) => {
    await navigateTo(page, 2);
    await holdCurrentPage(page, 2);
    await navigateTo(page, 5);
    await holdCurrentPage(page, 5);
    await page.getByRole('button', { name: '打开第 2 页参考窗口', exact: true }).click();
    await page.getByRole('button', { name: '打开第 5 页参考窗口', exact: true }).click();
    await expect(page.locator('[data-floating-window]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-floating-window]')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '参考阅读区，第 2 页', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '参考阅读区，第 5 页', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expectMainPage(page, 5);
    await expect(reader(page)).toBeFocused();
  });
});
