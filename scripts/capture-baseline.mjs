// Synthetic, read-only comparison evidence from the pinned pre-polish revision.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const output = resolve('baseline-evidence');
await mkdir(output, { recursive: true });
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto('http://127.0.0.1:4174');
    await page.getByRole('heading', { name: '页境阅读' }).waitFor();
    await page.screenshot({ path: `${output}/${name}-welcome.png`, fullPage: true });
    await page.locator('input[type=file]').setInputFiles(resolve('src/tests/fixtures/leafspace-12-pages.pdf'));
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    await page.screenshot({ path: `${output}/${name}-reader.png`, fullPage: true });
    await page.keyboard.press('Space');
    await page.getByText('速翻视图', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/${name}-quick-flip.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
