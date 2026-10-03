import { test, expect, importBook, reader } from './helpers';
import type { Page } from '@playwright/test';

test.setTimeout(90_000);
const observations = new WeakMap<Page, unknown[]>();
test.beforeEach(async ({ page }) => {
  const entries: unknown[] = []; observations.set(page, entries);
  page.on('console', message => {
    const value = message.text();
    if (value.startsWith('FIT_GEOMETRY:') && entries.length < 5000) entries.push(JSON.parse(value.slice(13)));
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('live-layout-events', { body: JSON.stringify({ gutter: process.env.FIT_GUTTER, events: observations.get(page) }), contentType: 'application/json' });
});
async function openFixture(page: Page) {
  await page.goto('/');
  if (process.env.FIT_GUTTER === 'stable') await page.addStyleTag({ content: '[aria-label="主阅读区"] { scrollbar-gutter: stable; }' });
  if (process.env.FIT_GUTTER === 'forced') await page.addStyleTag({ content: '[aria-label="主阅读区"] { overflow-y: scroll; }' });
  await importBook(page);
}

test('measures the complete bordered paper at nominal fit width', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openFixture(page);
  const entries = [];
  for (const width of [390, 639, 640, 720, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '恢复适合宽度', exact: true }).click();
    await expect.poll(() => reader(page).evaluate(element => {
      const canvas = element.querySelector('canvas')!;
      const padding = innerWidth < 640 ? 32 : 80;
      return Math.abs(canvas.getBoundingClientRect().width - Math.floor(Math.min(612, Math.max(1, element.clientWidth - padding - 2))));
    })).toBeLessThan(0.1);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const geometry = await reader(page).evaluate(element => {
      const canvas = element.querySelector('canvas')!, frame = canvas.closest('.w-max')!, paper = canvas.closest('.react-pdf__Page')!;
      const bounds = element.getBoundingClientRect(), canvasBounds = canvas.getBoundingClientRect(), frameBounds = frame.getBoundingClientRect();
      const padding = getComputedStyle(frame.parentElement!), border = getComputedStyle(paper);
      return { viewportWidth: innerWidth, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        horizontalRange: element.scrollWidth - element.clientWidth, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop,
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
        canvasWidth: canvasBounds.width, frameWidth: frameBounds.width, frameCenterDelta: frameBounds.x + frameBounds.width / 2 - bounds.x - element.clientWidth / 2,
        paddingLeft: padding.paddingLeft, paddingRight: padding.paddingRight, borderLeft: border.borderLeftWidth, borderRight: border.borderRightWidth,
        touchAction: getComputedStyle(element).touchAction };
    });
    entries.push(geometry);
    await info.attach(`fit-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  await info.attach('fit-border-geometry', { body: JSON.stringify(entries, null, 2), contentType: 'application/json' });
  for (const entry of entries) expect.soft(entry.horizontalRange, `No horizontal scrolling at 100% in ${entry.viewportWidth}px viewport`).toBe(0);
});

test('fit width remains stable near classic scrollbar height thresholds', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 }); await openFixture(page);
  await reader(page).evaluate(element => {
    const events: object[] = [];
    const frame = element.querySelector('.w-max')!;
    const observer = new ResizeObserver(() => {
      const event = { type: 'resize', time: performance.now(), clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, frameWidth: (frame as HTMLElement).style.width, frameHeight: (frame as HTMLElement).style.height };
      events.push(event); console.debug(`FIT_GEOMETRY:${JSON.stringify(event)}`);
    });
    observer.observe(element); observer.observe(frame);
    window.addEventListener('error', event => {
      const detail = { type: 'error', time: performance.now(), message: event.message };
      events.push(detail); console.debug(`FIT_GEOMETRY:${JSON.stringify(detail)}`);
    });
    (window as unknown as { fitEvents: object[] }).fitEvents = events;
  });
  const series = [];
  for (const height of [844, 839, 844, 854, 844]) {
    await page.setViewportSize({ width: 390, height });
    const samples = await reader(page).evaluate(async element => {
      const entries = [];
      for (let index = 0; index < 120; index++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const canvas = element.querySelector('canvas')!, frame = element.querySelector<HTMLElement>('.w-max')!;
        const paper = canvas.getBoundingClientRect();
        entries.push({ clientWidth: element.clientWidth, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight, frameWidth: frame.style.width, frameHeight: frame.style.height,
          canvasWidth: paper.width, canvasHeight: paper.height, gutter: getComputedStyle(element).scrollbarGutter, overflowY: getComputedStyle(element).overflowY });
      }
      return entries;
    });
    series.push({ height, samples });
  }
  const events = await page.evaluate(() => (window as unknown as { fitEvents: object[] }).fitEvents);
  await info.attach('fit-height-stability', { body: JSON.stringify({ series, events }), contentType: 'application/json' });
  await info.attach('fit-height-final-screen', { body: await page.screenshot(), contentType: 'image/png' });
  for (const { height, samples } of series) {
    const tail = samples.slice(-60);
    expect.soft(new Set(tail.map(sample => JSON.stringify(sample))).size, `Stable geometry at height ${height}`).toBe(1);
    expect.soft(tail.every(sample => sample.scrollWidth === sample.clientWidth), `No horizontal range at height ${height}`).toBe(true);
  }
});

test('static scrollbar isolation without React PDF or app styling', async ({ page }, info) => {
  const variants = [
    { id: 'native-auto', custom: false, gutter: 'auto', overflow: 'auto' },
    { id: 'native-stable', custom: false, gutter: 'stable', overflow: 'auto' },
    { id: 'custom-auto', custom: true, gutter: 'auto', overflow: 'auto' },
    { id: 'custom-stable', custom: true, gutter: 'stable', overflow: 'auto' },
    { id: 'custom-forced', custom: true, gutter: 'auto', overflow: 'scroll' },
  ];
  await page.setContent(`<style>body{font:14px sans-serif;margin:16px;display:grid;grid-template-columns:repeat(3,320px);gap:20px}.custom::-webkit-scrollbar{width:10px;height:10px}.custom::-webkit-scrollbar-thumb{background:#888}</style>${variants.map(v => `<section><p>${v.id}</p><div id="${v.id}" class="${v.custom ? 'custom' : ''}" style="width:300px;height:200px;overflow-x:auto;overflow-y:${v.overflow};scrollbar-gutter:${v.gutter};background:#eee"><div style="height:100px;background:#ddd">Scrollbar control</div></div></section>`).join('')}`);
  const measurements = [];
  for (const height of [100, 600, 100]) {
    await page.evaluate(height => document.querySelectorAll('section > div > div').forEach(child => (child as HTMLElement).style.height = `${height}px`), height);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    measurements.push({ height, boxes: await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('section > div')).map(element => ({
      id: element.id, offsetWidth: element.offsetWidth, clientWidth: element.clientWidth, gutter: getComputedStyle(element).scrollbarGutter,
      offsetHeight: element.offsetHeight, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY,
    }))) });
  }
  await info.attach('static-scrollbar-measurement', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  await info.attach('static-scrollbar-screen', { body: await page.screenshot(), contentType: 'image/png' });
  expect(measurements).toHaveLength(3);
});
