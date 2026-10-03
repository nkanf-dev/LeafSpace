// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const asset = (path: string) => readFileSync(new URL(`public/${path}`, root));
const html = readFileSync(new URL('index.html', root), 'utf8');
const manifest = JSON.parse(asset('site-v1.webmanifest').toString());

describe('LeafSpace browser and home-screen identity', () => {
  it('declares branded, versioned icons instead of starter assets', () => {
    expect(html).toContain('<title>LeafSpace · 页境</title>');
    for (const path of ['favicon.ico?v=leafspace-1', 'leafspace-icon-32-v1.png', 'leafspace-icon-v1.svg', 'apple-touch-icon-v1.png', 'site-v1.webmanifest']) {
      expect(html).toContain(`href="/${path}"`);
      expect(existsSync(new URL(`public/${path.split('?')[0]}`, root))).toBe(true);
    }
    expect(html).not.toMatch(/vite\.svg|react\.svg/);
    expect(existsSync(new URL('public/vite.svg', root))).toBe(false);
    expect(asset('leafspace-icon-v1.svg').toString()).toContain('<title>LeafSpace</title>');
  });

  it('provides real 16, 32 and 48 px images at the conventional favicon route', async () => {
    const ico = asset('favicon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    for (const [index, size] of [16, 32, 48].entries()) {
      const entry = 6 + index * 16;
      expect([ico[entry], ico[entry + 1]]).toEqual([size, size]);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + length);
      const metadata = await sharp(png).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', size, size]);
      if (size === 32) expect(png).toEqual(asset('leafspace-icon-32-v1.png'));
    }
  });

  it('keeps home-screen images opaque and correctly sized without changing launch mode', async () => {
    expect(manifest.name).toBe('LeafSpace · 页境');
    expect(manifest.short_name).toBe('LeafSpace');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('browser');
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const [path, size] of [['apple-touch-icon-v1.png', 180], ['leafspace-icon-192-v1.png', 192], ['leafspace-icon-512-v1.png', 512]] as const) {
      const image = sharp(fileURLToPath(new URL(`public/${path}`, root)));
      const metadata = await image.metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', size, size]);
      expect((await image.stats()).isOpaque).toBe(true);
    }
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(existsSync(new URL(`public${icon.src}`, root))).toBe(true);
    }
  });
});
