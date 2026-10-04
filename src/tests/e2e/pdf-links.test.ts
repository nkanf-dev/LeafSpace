import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import { test, expect, importBook, reader, quickFlip } from './helpers';

const fixture = fileURLToPath(new URL('../fixtures/leafspace-links.pdf', import.meta.url));
const colors = [[51, 128, 77], [26, 89, 179], [179, 64, 26]];
const annotation = (region: Locator, id: string) => region.locator(`.annotationLayer [data-annotation-id="${id}"] a`);

async function expectPage(region: Locator, pageNumber: number) {
  await expect(region.locator('.react-pdf__Page')).toHaveAttribute('data-page-number', String(pageNumber));
  await expect(region.locator('canvas')).toBeVisible();
  await expect.poll(async () => {
    const pixel = await region.locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * 50 / 420), Math.floor(canvas.height * 27 / 594), 1, 1).data));
    return pixel[3] === 255 && colors[pageNumber - 1].every((channel, index) => Math.abs(channel - pixel[index]) <= 1);
  }, { message: `Page ${pageNumber} has its own decoded color bar` }).toBe(true);
}

test('a numeric internal PDF link renders its unmounted target in the main reader', async ({ page }, info) => {
  await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  await annotation(reader(page), '10R').click();
  await expectPage(reader(page), 2); await expect(page.locator('header')).toContainText('第 2 页');
  await info.attach('internal-main-link-destination', { body: await page.screenshot(), contentType: 'image/png' });
});

test('a named internal PDF link navigates its reference even when main already renders the destination', async ({ page }, info) => {
  test.skip(['tablet', 'mobile', 'mobile-webkit'].includes(info.project.name), 'Simultaneously visible main and reference ownership');
  await page.goto('/'); await importBook(page, fixture); await expectPage(reader(page), 1);
  await page.getByRole('button', { name: /^速翻/ }).click(); await expect(quickFlip(page)).toBeVisible();
  await page.keyboard.press('n');
  const reference = page.getByRole('region', { name: /^参考阅读区/ }); await expectPage(reference, 1);
  await reader(page).focus(); await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 2);
  await page.keyboard.press('ArrowRight'); await expectPage(reader(page), 3);
  await annotation(reference, '11R').click();
  await expectPage(reference, 3); await expectPage(reader(page), 3);
  await expect(page.locator('header')).toContainText('第 3 页');
  await info.attach('internal-reference-link-destination', { body: await page.screenshot(), contentType: 'image/png' });
});
