import { test, expect } from '@playwright/test';

test('serves and decodes the LeafSpace tab and home-screen icons', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle('LeafSpace · 页境');
  const links = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(elements =>
    elements.map(element => ({ href: element.getAttribute('href')!, type: element.getAttribute('type') })),
  );
  expect(links.map(link => link.href)).toEqual([
    '/favicon.ico?v=leafspace-1', '/leafspace-icon-32-v1.png', '/leafspace-icon-v1.svg', '/apple-touch-icon-v1.png',
  ]);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site-v1.webmanifest');
  const manifestResponse = await request.get('/site-v1.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toMatch(/application\/(manifest\+json|json)/);
  const manifest = await manifestResponse.json();
  expect(manifest.short_name).toBe('LeafSpace');

  const sources = [...links.map(link => link.href), ...manifest.icons.map((icon: { src: string }) => icon.src), '/favicon.ico'];
  for (const src of sources) {
    const response = await request.get(src);
    expect(response.ok(), src).toBe(true);
    expect(response.headers()['content-type'], src).toMatch(/^image\//);
    const size = await page.evaluate(async source => {
      const image = new Image();
      image.src = source;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, src);
    expect(size.width, src).toBeGreaterThan(0);
    expect(size.height, src).toBeGreaterThan(0);
  }

  // Capture the actual served mark at tab sizes on light and dark surfaces,
  // plus the home-screen asset. This does not claim physical-device coverage.
  await page.setContent(`<main style="display:flex;gap:24px;padding:32px;font-family:system-ui">
    ${['#fcfaf6', '#292524'].map(background => `<section style="background:${background};padding:24px;display:flex;gap:16px;align-items:center">
      ${[16, 32, 64].map(size => `<img src="/leafspace-icon-v1.svg" width="${size}" height="${size}" alt="LeafSpace ${size}px">`).join('')}
    </section>`).join('')}
    <img src="/apple-touch-icon-v1.png" width="180" height="180" alt="LeafSpace home-screen icon">
  </main>`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await testInfo.attach('leafspace-site-icons', { body: await page.screenshot(), contentType: 'image/png' });
});
