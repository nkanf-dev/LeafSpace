import { test, expect, importBook, reader, navigateTo, holdCurrentPage, snapshots, reopenRecent, expectMainPage } from './helpers';

for (const key of ['Enter', 'Space']) {
  test(`held-page ${key} activation remains native and does not open Quick Flip`, async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 1024, 'Keyboard path is exercised in desktop projects');
    await page.goto('/'); await importBook(page);
    await navigateTo(page, 8); await holdCurrentPage(page, 8);
    await navigateTo(page, 3);
    await page.getByRole('button', { name: '阅读第 8 页', exact: true }).focus();
    await page.keyboard.press(key);
    await expectMainPage(page, 8);
    await expect(page.getByRole('dialog', { name: '速翻视图' })).toHaveCount(0);
    await expect(page.locator('[data-reader-pane]')).toHaveCount(1);
  });
}

for (const origin of ['main', 'reference'] as const) {
  test(`slow native double click preserves the ${origin} paper position and saves that comparison`, async ({ page, viewport }, info) => {
    test.skip((viewport?.width ?? 0) < 1024, 'Compact layouts use single activation plus the explicit comparison action');
    await page.goto('/'); await importBook(page);
    await navigateTo(page, 8); await holdCurrentPage(page, 8);
    await navigateTo(page, 5); await holdCurrentPage(page, 5);
    await navigateTo(page, 3);
    if (origin === 'reference') await page.getByRole('button', { name: '打开第 5 页参考窗口', exact: true }).click();
    const initial = origin === 'main' ? reader(page) : page.getByRole('region', { name: '参考阅读区，第 5 页', exact: true });
    await expect(initial.locator('canvas')).toBeVisible();
    const id = await initial.evaluate(element => element.closest<HTMLElement>('[data-window-id]')!.dataset.windowId!);
    const region = page.locator(`[data-window-id="${id}"] [role="region"]`);
    for (let index = 0; index < 5; index++) {
      const width = await region.locator('canvas').evaluate(element => element.getBoundingClientRect().width);
      await region.locator('xpath=ancestor::*[@data-reader-shell][1]').getByRole('button', { name: '放大', exact: true }).click();
      await expect.poll(() => region.locator('canvas').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(width * 1.15);
    }
    await region.evaluate(element => element.scrollTo(120, 350));
    await expect.poll(() => region.evaluate(element => element.scrollTop)).toBe(350);
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(120);
    await expect.poll(async () => (await snapshots(page))[0]?.windows.find(window => window.id === id)?.viewport?.scrollTop).toBe(350);
    const before = (await snapshots(page))[0].windows.find(window => window.id === id)!;
    const count = await page.locator('[data-reader-pane]').count();
    const held = page.getByRole('button', { name: '阅读第 8 页', exact: true });
    await held.click();
    await expect(region.locator('.react-pdf__Page')).toHaveAttribute('data-page-number', '8');
    // Complete the recognized native click sequence after the delayed read has
    // committed. clickCount=2 belongs to this second down/up, not a third click.
    const box = await held.boundingBox();
    if (!box) throw new Error('Held-page target disappeared');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
    await expect(page.locator('[data-reader-pane]')).toHaveCount(count + 1);
    await expect(region.locator('.react-pdf__Page')).toHaveAttribute('data-page-number', String(before.pageNumber));
    await expect(region.locator('canvas')).toBeVisible();
    await expect.poll(() => region.evaluate(element => Math.max(Math.abs(element.scrollLeft - 120), Math.abs(element.scrollTop - 350)))).toBeLessThanOrEqual(2);
    await expectMainPage(page, 3);
    await page.getByRole('button', { name: '保存现场', exact: true }).click();
    await expect.poll(async () => (await snapshots(page))[0]?.windows.length).toBe(count + 1);
    expect((await snapshots(page))[0].windows.find(window => window.id === id)).toMatchObject({ pageNumber: before.pageNumber, viewport: before.viewport });
    await reopenRecent(page);
    await expect(region.locator('canvas')).toBeVisible();
    await expect.poll(() => region.evaluate(element => Math.max(Math.abs(element.scrollLeft - 120), Math.abs(element.scrollTop - 350)))).toBeLessThanOrEqual(2);
    await info.attach(`${origin}-slow-double-click-restored`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('compact held-page activation returns to reading and explicit comparison preserves the origin', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await importBook(page);
  await navigateTo(page, 8);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await navigateTo(page, 3);
  const toggle = page.getByRole('button', { name: '夹页 1', exact: true });
  await toggle.click();
  const held = page.getByRole('button', { name: '阅读第 8 页', exact: true });
  if (info.project.use.hasTouch) await held.tap(); else await held.click();
  await expectMainPage(page, 8);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-reader-pane]')).toHaveCount(1);
  await navigateTo(page, 3);
  await toggle.click();
  const compare = page.getByRole('button', { name: '打开第 8 页参考窗口', exact: true });
  if (info.project.use.hasTouch) await compare.tap(); else await compare.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: '参考阅读区，第 8 页', exact: true }).locator('canvas')).toBeVisible();
  await expect(page.locator('header')).toContainText('第 3 页');
});
