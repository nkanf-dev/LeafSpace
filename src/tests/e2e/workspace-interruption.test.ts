import { test, expect, importBook, reader, holdCurrentPage, navigateTo, expectMainPage } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await importBook(page);
});

test('ordinary mouse pan and inactive-reference drag survive their own reading-state updates', async ({ page }, info) => {
  const region = reader(page);
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(() => region.evaluate(element => element.scrollWidth > element.clientWidth + 100)).toBe(true);
  const box = await region.boundingBox(); if (!box) throw new Error('Missing reader');
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7 - 50, box.y + box.height * 0.7 - 50, { steps: 4 });
  const mid = await region.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }));
  await page.mouse.move(box.x + box.width * 0.7 - 130, box.y + box.height * 0.7 - 130, { steps: 8 });
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(mid.y + 40);
  await page.mouse.up();
  await holdCurrentPage(page, 1); await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
  const floating = page.locator('[data-floating-window]'); await expect(floating.locator('canvas')).toBeVisible();
  await region.focus(); // Make the reference inactive before its drag starts.
  await expect(floating).toHaveAttribute('data-mobile-active', 'false');
  const before = await floating.boundingBox(); const title = await floating.getByText('参考: P.1', { exact: true }).boundingBox();
  if (!before || !title) throw new Error('Missing floating reference');
  const workspace = await floating.evaluate(element => ({ top: element.parentElement!.getBoundingClientRect().top, height: element.parentElement!.clientHeight }));
  expect(before.y - workspace.top).toBeGreaterThan(42);
  await page.mouse.move(title.x + 20, title.y + 5); await page.mouse.down();
  // Drag upward into free space. A downward drag at the initial bottom clamp
  // legitimately tests the window boundary rather than continued input ownership.
  await page.mouse.move(title.x + 80, title.y - 25, { steps: 8 }); await page.mouse.up();
  const after = await floating.boundingBox();
  await info.attach('ordinary-pan-and-inactive-drag', { body: JSON.stringify({ midPan: mid, before, after, workspace }), contentType: 'application/json' });
  expect(after!.x - before.x).toBeGreaterThan(40); expect(before.y - after!.y).toBeGreaterThan(20);
  await expect(page.locator('[data-thumbnail-actions]')).toHaveCount(0);
});

for (const layout of ['floating', 'split', 'grid'] as const) {
  test(`keyboard close in ${layout} layout returns to the surviving reader`, async ({ page }) => {
    await holdCurrentPage(page, 1);
    await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
    await expect(page.getByRole('region', { name: '参考阅读区，第 1 页', exact: true }).locator('canvas')).toBeVisible();
    if (layout !== 'floating') await page.getByRole('combobox', { name: '工作区布局' }).selectOption(layout);
    const close = page.getByRole('button', { name: '关闭', exact: true });
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(close).toHaveCount(0);
    await expect(reader(page)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expectMainPage(page, 2);
  });
}

test('held-page removal cancels back to its opener, skips covered controls, and keeps a useful focus after deletion', async ({ page }) => {
  await holdCurrentPage(page, 1);
  await navigateTo(page, 2);
  await holdCurrentPage(page, 2);
  await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
  const remove = page.getByRole('button', { name: '移除第 1 页夹页', exact: true });
  await remove.click();
  await expect(page.getByRole('button', { name: '保留窗口', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '保留窗口', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
  await remove.click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(remove).toBeFocused();
  await remove.click();
  await page.getByRole('button', { name: '保留窗口', exact: true }).click();
  await expect(page.getByRole('button', { name: '阅读第 2 页', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '移除第 2 页夹页', exact: true }).click();
  await expect(page.getByRole('heading', { name: '夹住的页面 (0)', exact: true })).toBeFocused();
  await expect(page.locator('[data-floating-window]')).toHaveCount(1);
});

for (const interruption of ['blur', 'Escape'] as const) {
  test(`native window dragging stops on ${interruption} before another move or window-close action`, async ({ page }) => {
    await holdCurrentPage(page, 1);
    await page.getByRole('button', { name: '打开第 1 页参考窗口', exact: true }).click();
    const floating = page.locator('[data-floating-window]');
    const title = floating.getByText('参考: P.1', { exact: true });
    await expect(floating.locator('canvas')).toBeVisible();
    const handle = await title.boundingBox();
    if (!handle) throw new Error('Missing floating window title');
    await page.mouse.move(handle.x + 20, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 35, handle.y + 15);
    await expect(page.locator('body')).toHaveClass(/is-panning/);
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/is-panning/);
    const settled = await floating.boundingBox();
    await page.mouse.move(handle.x + 90, handle.y + 40);
    await page.mouse.up();
    await expect(floating).toHaveCount(1);
    expect(await floating.boundingBox()).toEqual(settled);
    await reader(page).focus();
    await page.keyboard.press('Escape');
    await expect(floating).toHaveCount(0);
  });
}
