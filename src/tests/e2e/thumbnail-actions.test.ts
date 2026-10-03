import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, importBook, navigateTo, expectMainPage, quickFlip, reader, openQuickFlip } from './helpers';

// Cross-engine event contracts. Native touch arbitration is additionally covered
// by the Chromium CDP scenarios in native-touch.test.ts; this is not iOS hardware.
async function down(target: Locator, id = 7) {
  const box = await target.boundingBox(); if (!box) throw new Error('Missing thumbnail');
  const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: id };
  await target.dispatchEvent('pointerdown', { ...point, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  return point;
}
async function end(page: Page, point: { clientX: number; clientY: number; pointerId: number }, type = 'pointerup') {
  await page.evaluate(({ point, type }) => window.dispatchEvent(new PointerEvent(type, { ...point, pointerType: 'touch', bubbles: true })), { point, type });
}
async function actions(page: Page, target: Locator, number: number) {
  const point = await down(target);
  const dialog = page.getByRole('dialog', { name: `第 ${number} 页操作`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '阅读此页', exact: true })).toBeDisabled();
  await end(page, point);
  // Older browsers expose compatibility clicks as MouseEvent rather than PointerEvent.
  await target.dispatchEvent('click', { ...point, detail: 1, bubbles: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '阅读此页', exact: true })).toBeEnabled();
  return dialog;
}

test('thumbnail actions sit above Quick Flip, preserve its selection, and return useful focus', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await importBook(page); await navigateTo(page, 3);
  await page.getByRole('button', { name: /^速翻/ }).click();
  await expect.poll(() => page.getByRole('button', { name: '选择第 3 页', exact: true }).evaluate(element => {
    const strip = element.closest<HTMLElement>('.quick-flip-strip')!;
    const expected = Math.max(0, strip.scrollLeft + element.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - (element as HTMLElement).clientWidth) / 2);
    return Math.abs(expected - strip.scrollLeft);
  })).toBeLessThanOrEqual(1);
  const target = page.getByRole('button', { name: '选择第 4 页', exact: true });
  await target.scrollIntoViewIfNeeded();
  const scroll = await page.locator('.quick-flip-strip').evaluate(element => element.scrollLeft);
  let dialog = await actions(page, target, 4);
  await expect(page.locator('[aria-label="速翻视图"]')).toHaveAttribute('inert', '');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  for (const button of await dialog.getByRole('button').all()) {
    await expect(button).toBeInViewport();
    expect(await button.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
  }
  await info.attach('quick-flip-thumbnail-actions', { body: await page.screenshot(), contentType: 'image/png' });
  expect((await new AxeBuilder({ page }).include('[data-thumbnail-actions]').analyze()).violations).toEqual([]);
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: '阅读此页', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('n');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(quickFlip(page)).toBeVisible(); await expect(target).toBeFocused();
  await expect(page.getByRole('button', { name: '选择第 3 页', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.quick-flip-strip').evaluate(element => element.scrollLeft)).toBe(scroll);
  dialog = await actions(page, target, 4);
  await dialog.getByRole('button', { name: '夹住此页', exact: true }).click();
  await expect(target).toBeFocused(); await expect(quickFlip(page)).toBeVisible();
  dialog = await actions(page, target, 4);
  await expect(dialog.getByRole('button', { name: '取消夹页', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '打开参考窗', exact: true }).click();
  await expect(quickFlip(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: '参考阅读区，第 4 页', exact: true }).locator('canvas')).toBeVisible();
  await expect(page.locator('header')).toContainText('第 3 页');
});

test('held actions cancel interrupted presses and preserve linked-window removal choices', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await importBook(page); await navigateTo(page, 8);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click(); await navigateTo(page, 3);
  const toggle = page.getByRole('button', { name: '夹页 1', exact: true }); await toggle.click();
  const target = page.getByRole('button', { name: '阅读第 8 页', exact: true });
  for (const interrupt of ['move', 'second-contact', 'cancel']) {
    const point = await down(target);
    await page.evaluate(({ point, interrupt }) => {
      const type = interrupt === 'move' ? 'pointermove' : interrupt === 'cancel' ? 'pointercancel' : 'pointerdown';
      window.dispatchEvent(new PointerEvent(type, { ...point, pointerType: 'touch', clientX: point.clientX + 30, pointerId: interrupt === 'second-contact' ? 8 : point.pointerId }));
    }, { point, interrupt });
    await page.waitForTimeout(550);
    await end(page, point);
    await expect(page.getByRole('dialog', { name: '第 8 页操作' })).toHaveCount(0);
    await expect(page.locator('header')).toContainText('第 3 页');
  }
  let dialog = await actions(page, target, 8);
  await info.attach('held-thumbnail-actions', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape'); await expect(target).toBeFocused(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  dialog = await actions(page, target, 8);
  await dialog.getByRole('button', { name: '打开参考窗', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const reference = page.getByRole('region', { name: '参考阅读区，第 8 页', exact: true }); await expect(reference.locator('canvas')).toBeVisible();
  await toggle.click(); dialog = await actions(page, target, 8);
  await dialog.getByRole('button', { name: '移除夹页', exact: true }).click();
  const keep = page.getByRole('button', { name: '保留窗口', exact: true }); await expect(keep).toBeFocused(); await keep.click();
  await expect(page.getByRole('heading', { name: '夹住的页面 (0)', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(reference).toBeVisible(); await expect(page.locator('header')).toContainText('第 3 页');
});

test('resizing an action sheet recovers visible focus across drawer breakpoints and Quick Flip rotation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await importBook(page);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  const toggle = page.getByRole('button', { name: '夹页 1', exact: true }); await toggle.click();
  const held = page.getByRole('button', { name: '阅读第 1 页', exact: true });
  await actions(page, held, 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-thumbnail-actions]')).toHaveCount(0); await expect(held).toBeFocused();
  await actions(page, held, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-thumbnail-actions]')).toHaveCount(0); await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await openQuickFlip(page);
  const thumbnail = page.getByRole('button', { name: '选择第 1 页', exact: true }); await actions(page, thumbnail, 1);
  await page.setViewportSize({ width: 740, height: 390 });
  await expect(page.locator('[data-thumbnail-actions]')).toHaveCount(0); await expect(thumbnail).toBeFocused();
  await expect(quickFlip(page)).toBeVisible();
  await expect(thumbnail).toHaveAttribute('aria-pressed', 'true');
});

for (const size of [{ width: 320, height: 568 }, { width: 740, height: 320 }]) {
  test(`thumbnail action sheet remains reachable at ${size.width} by ${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size); await page.goto('/'); await importBook(page);
    await openQuickFlip(page);
    const target = page.getByRole('button', { name: '选择第 1 页', exact: true });
    const dialog = await actions(page, target, 1);
    for (const button of await dialog.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport();
      expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await info.attach(`thumbnail-actions-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: '阅读此页', exact: true }).focus();
    await page.keyboard.press(size.width === 320 ? 'Enter' : 'Space');
    await expectMainPage(page, 1); await expect(reader(page)).toBeFocused();
  });
}
