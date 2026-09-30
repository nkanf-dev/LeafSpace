// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const wrangler = JSON.parse(readFileSync(resolve(projectRoot, 'wrangler.jsonc'), 'utf8'));

describe('Cloudflare Workers static deployment', () => {
  it('serves the actual Vite production output directory', async () => {
    const vite = await resolveConfig({ root: projectRoot }, 'build');

    expect(resolve(projectRoot, wrangler.assets.directory)).toBe(resolve(vite.root, vite.build.outDir));
  });

  it('keeps the existing Worker name and client-side navigation fallback', () => {
    expect(wrangler.name).toBe('leafspace');
    expect(wrangler.assets.not_found_handling).toBe('single-page-application');
  });
});
