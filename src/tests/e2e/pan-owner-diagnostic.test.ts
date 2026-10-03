import { test, expect, importBook, reader } from './helpers';

test('rapid native mouse movement retains its latest pan target', async ({ page }, info) => {
  await page.goto('/'); await importBook(page);
  const region = reader(page);
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(() => region.locator('canvas').evaluate(element => element.getBoundingClientRect().width)).toBe(Math.floor(612 * 1.2 ** 4));
  await region.evaluate(element => element.scrollTo(100, 200));
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBe(200);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await region.evaluate(element => {
    const events: object[] = [];
    const record = (event: Event) => {
      const mouse = event as MouseEvent;
      events.push({ type: event.type, time: performance.now(), trusted: event.isTrusted, buttons: mouse.buttons,
        x: mouse.clientX, y: mouse.clientY, left: element.scrollLeft, top: element.scrollTop, cursor: getComputedStyle(element).cursor });
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'scroll']) element.addEventListener(type, record);
    (window as unknown as { panDiagnostic: object[] }).panDiagnostic = events;
  });
  const box = await region.boundingBox(); if (!box) throw new Error('Missing reader');
  const before = await region.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop, range: element.scrollHeight - element.clientHeight }));
  expect(before.range).toBeGreaterThan(before.top + 200);
  const origin = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };
  await page.mouse.move(origin.x, origin.y); await page.mouse.down();
  await page.mouse.move(origin.x - 50, origin.y - 50, { steps: 4 });
  const mid = await region.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  await page.mouse.move(origin.x - 130, origin.y - 130, { steps: 8 });
  await page.waitForTimeout(500);
  const after = await region.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop, cursor: getComputedStyle(element).cursor }));
  await page.mouse.up();
  const events = await page.evaluate(() => (window as unknown as { panDiagnostic: object[] }).panDiagnostic);
  await info.attach('pan-target-diagnostic', { body: JSON.stringify({ before, mid, after, events }, null, 2), contentType: 'application/json' });
  await info.attach('pan-target-screen', { body: await page.screenshot(), contentType: 'image/png' });
  expect(after.top).toBeGreaterThan(mid.top + 40);
});
