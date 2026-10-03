// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('declares the Simplified Chinese interface language for assistive technology', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<html\s+lang="zh-Hans"\s*>/);
});
