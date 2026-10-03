import { test, expect, importBook, reader } from './helpers';

test('measures the complete bordered paper at nominal fit width', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await importBook(page);
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
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto('/'); await importBook(page);
  await reader(page).evaluate(element => {
    const events: object[] = [];
    const frame = element.querySelector('.w-max')!;
    const observer = new ResizeObserver(() => events.push({ type: 'resize', time: performance.now(), clientWidth: element.clientWidth, clientHeight: element.clientHeight }));
    observer.observe(element); observer.observe(frame);
    window.addEventListener('error', event => events.push({ type: 'error', time: performance.now(), message: event.message }));
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
          canvasWidth: paper.width, canvasHeight: paper.height, gutter: getComputedStyle(element).scrollbarGutter });
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
