import { test, expect, importBook, navigateTo, quickFlip, openQuickFlip } from './helpers';

test('compares Quick Flip legibility with and without native backdrop filters', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await importBook(page);
  await navigateTo(page, 4); await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await navigateTo(page, 3);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openQuickFlip(page);
    const overlay = quickFlip(page);
    const selected = page.getByRole('button', { name: '选择第 3 页', exact: true });
    for (const number of [2, 3, 4]) {
      const image = overlay.getByRole('img', { name: `第 ${number} 页缩略图`, exact: true });
      await expect(image).toBeVisible();
      expect(await image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const backdrop = overlay.locator(':scope > div').first();
    for (const filter of ['native', 'none']) {
      await backdrop.evaluate((element, filter) => {
        (element as HTMLElement).style.setProperty('backdrop-filter', filter === 'none' ? 'none' : 'blur(40px)');
        (element as HTMLElement).style.setProperty('-webkit-backdrop-filter', filter === 'none' ? 'none' : 'blur(40px)');
      }, filter);
      for (const alpha of [0.7, 0.92]) {
        await backdrop.evaluate((element, alpha) => { (element as HTMLElement).style.backgroundColor = `rgba(251, 250, 248, ${alpha})`; }, alpha);
        await info.attach(`backdrop-${width}-${filter}-${alpha}`, { body: await page.screenshot(), contentType: 'image/png' });
        await info.attach(`style-${width}-${filter}-${alpha}`, { body: JSON.stringify(await backdrop.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, filter: getComputedStyle(element).backdropFilter }))), contentType: 'application/json' });
      }
    }
    if (width === 390) {
      const scroll = await page.locator('.quick-flip-strip').evaluate(element => element.scrollLeft);
      const box = await selected.boundingBox(); if (!box) throw new Error('Missing selected thumbnail');
      const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 7 };
      await selected.dispatchEvent('pointerdown', { ...point, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
      const dialog = page.getByRole('dialog', { name: '第 3 页操作', exact: true });
      await expect(dialog).toBeVisible();
      await page.evaluate(point => window.dispatchEvent(new PointerEvent('pointerup', { ...point, pointerType: 'touch', bubbles: true })), point);
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
      await info.attach('backdrop-390-none-0.92-actions', { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0); await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      expect(await page.locator('.quick-flip-strip').evaluate(element => element.scrollLeft)).toBe(scroll);
    }
    await page.keyboard.press('Escape'); await expect(overlay).toHaveCount(0);
  }
});
