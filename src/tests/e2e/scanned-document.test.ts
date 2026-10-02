import { test, expect, reader, snapshots } from './helpers';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A genuine 106 MB raster-only PDF, generated locally with no private scans.
// Unique raw RGB image objects exercise the actual large-document pipeline.
function makeScannedPdf() {
  const count = 24, width = 1024, height = 1448;
  const objects: Buffer[] = [];
  const add = (data: string | Buffer) => objects.push(typeof data === 'string' ? Buffer.from(data) : data);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let page = 0; page < count; page++) {
    const id = 3 + page * 3;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 512 724] /Resources << /XObject << /Scan ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = 'q 512 0 0 724 0 0 cm /Scan Do Q';
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pixels = Buffer.alloc(width * height * 3, 246);
    for (let row = 100; row < 1250; row += 44) {
      for (let y = row; y < row + 8; y++) pixels.fill(42 + page * 3, (y * width + 100) * 3, (y * width + 850 - page * 8) * 3);
    }
    add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from('\nendstream')]));
  }
  const chunks = [Buffer.from('%PDF-1.4\n')]; const offsets = [0]; let length = chunks[0].length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n')]);
    chunks.push(chunk); length += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test('100MB-class scanned PDF renders, navigates, holds and reloads from local storage', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const directory = mkdtempSync(join(tmpdir(), 'leafspace-scans-'));
  const file = join(directory, 'synthetic-106mb-scan.pdf');
  try {
    const bytes = makeScannedPdf();
    expect(bytes.length).toBeGreaterThan(100_000_000);
    writeFileSync(file, bytes);
    await page.goto('/');
    const started = Date.now();
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(reader(page).locator('canvas')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled({ timeout: 60_000 });
    await testInfo.attach('large-scan-import-timing', { body: JSON.stringify({ bytes: bytes.length, firstReadableAndStoredMs: Date.now() - started, browser: testInfo.project.name }), contentType: 'application/json' });
    const input = page.getByRole('textbox', { name: '输入页码' });
    await input.fill('24'); await input.press('Enter');
    await expect(reader(page).locator('[data-page-number="24"] canvas')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '夹住此页', exact: true }).click();
    await expect(page.getByRole('button', { name: '阅读第 24 页', exact: true }).locator('img')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '保存现场', exact: true }).click();
    await expect.poll(async () => (await snapshots(page))[0]?.currentPage).toBe(24);
    await testInfo.attach('large-scanned-reader', { body: await page.screenshot(), contentType: 'image/png' });
    await page.reload();
    await page.getByRole('button', { name: /synthetic-106mb-scan\.pdf/ }).click();
    await expect(reader(page).locator('[data-page-number="24"] canvas')).toBeVisible({ timeout: 60_000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
