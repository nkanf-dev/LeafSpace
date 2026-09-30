import { test, expect, importBook, reader } from './helpers';

test.describe('Application shell and recovery', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('welcomes a new reader and disables unavailable actions', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '页境阅读' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入一本 PDF', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存现场', exact: true })).toHaveCount(0);
    await expect(page.getByText('从第一本书开始', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: '跳转到页码' })).toHaveCount(0);
  });

  test('imports a real twelve-page PDF and renders its text and canvas', async ({ page }) => {
    await importBook(page);
    await expect(page.locator('header')).toContainText('leafspace-12-pages.pdf');
    await expect(reader(page).getByText('Page 1 of 12', { exact: true })).toBeAttached();
    await expect(page.getByRole('slider', { name: '跳转到页码' })).toHaveAttribute('max', '12');
    const canvas = reader(page).locator('canvas');
    expect(await canvas.evaluate((element) => element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0)).toBe(true);
  });

  test('reports invalid PDF input accessibly and can recover with a valid book', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('This is not a PDF document.'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存现场', exact: true })).toHaveCount(0);
    await importBook(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(reader(page)).toBeVisible();
  });

  test('reports an empty PDF rather than leaving the import busy forever', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
    await importBook(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
