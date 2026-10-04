import type { Locator, Page, TestInfo } from '@playwright/test';
import type { WorkspaceSnapshot } from '../../types/domain';
import { test, expect, BOOK_NAME, importBook, reader, expectMainPage, snapshots } from './helpers';

const saved = (page: Page) => page.getByText('已保存到本机', { exact: true });
const conflict = (page: Page) => page.getByRole('alert', { name: '问题详情', exact: true });
const confirmation = (page: Page) => page.getByRole('group', { name: '确认解决现场冲突', exact: true });

// Observe native writes only. Real UI edits and the normal CAS save path create
// the conflict; no application store, snapshot or conflict state is injected.
async function installWriteProbe(page: Page) {
  await page.addInitScript(() => {
    // Inactive real tabs have different native visibility across engines. Keep
    // lifecycle fixed so a hidden-save cannot race the paused setup debounce.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const writes = { workspaces: 0, books: 0 };
    Object.assign(window, { leafspaceResponsiveWrites: writes });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'workspaces') writes.workspaces++;
      if (this.name === 'books') writes.books++;
      return put.apply(this, args);
    };
  });
}

async function writes(page: Page, reset = false) {
  return page.evaluate(reset => {
    const counts = (window as unknown as {
      leafspaceResponsiveWrites: { workspaces: number; books: number };
    }).leafspaceResponsiveWrites;
    if (reset) { counts.workspaces = 0; counts.books = 0; }
    return counts;
  }, reset);
}

async function pauseDebounce(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
}

async function goToPage(page: Page, number: number) {
  const input = page.getByRole('textbox', { name: '输入页码', exact: true });
  await input.fill(String(number));
  await input.press('Enter');
  await expect(page.locator('header')).toContainText(`${BOOK_NAME} · 第 ${number} 页`);
  await reader(page).focus();
}

async function arrangeScene(page: Page, heldPage: number, mainPage: number, zoom = false) {
  await goToPage(page, heldPage);
  await page.getByRole('button', { name: '夹住此页', exact: true }).click();
  await goToPage(page, mainPage);
  if (zoom) await page.getByRole('button', { name: '放大', exact: true }).click();
}

async function expectScene(page: Page, mainPage: number, heldPage: number, zoom = false) {
  await expect(page.locator('header')).toContainText(`${BOOK_NAME} · 第 ${mainPage} 页`);
  await expect(page.getByRole('button', { name: '夹页 1', exact: true })).toBeVisible();
  // The timeline marker proves which page is held without covering the banners
  // with the compact drawer or creating desktop reference-window geometry.
  await expect(page.getByRole('button', { name: `跳转到夹页 ${heldPage}`, exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^跳转到夹页 / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '恢复适合宽度', exact: true })).toHaveText(zoom ? '120%' : '100%');
  await expect(page.getByRole('region', { name: /^参考阅读区/ })).toHaveCount(0);
}

async function expectPreserved(page: Page, durable: WorkspaceSnapshot) {
  await expectScene(page, 4, 3, true);
  expect((await snapshots(page))[0]).toEqual(durable);
  expect(await writes(page)).toEqual({ workspaces: 0, books: 0 });
}

async function captureStrip(page: Page, strip: Locator, info: TestInfo, name: string) {
  await expect(strip).toBeVisible();
  const geometry = await strip.evaluate(element => {
    const bounds = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const message = element.querySelector('p, span')!;
    const range = document.createRange();
    range.selectNodeContents(message);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      strip: { ...bounds(element), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth },
      message: { ...bounds(message), clientWidth: message.clientWidth, scrollWidth: message.scrollWidth },
      lines: Array.from(range.getClientRects(), box => ({ left: box.left, right: box.right })),
      buttons: Array.from(element.querySelectorAll('button'), button => {
        const box = bounds(button);
        const target = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
        return { label: button.getAttribute('aria-label') || button.textContent, ...box,
          clientWidth: button.clientWidth, scrollWidth: button.scrollWidth,
          centerReachable: !!target && button.contains(target) };
      }),
    };
  });
  // Keep evidence even when a width or hit-target assertion below fails.
  await info.attach(`${name}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  expect(geometry.documentWidth, 'No horizontal page overflow').toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.bodyWidth, 'No horizontal body overflow hidden by the root').toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.strip.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.strip.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.strip.width).toBeCloseTo(geometry.viewport.width, 0);
  expect(geometry.strip.scrollWidth, 'The Chinese strip has no nested horizontal overflow').toBeLessThanOrEqual(geometry.strip.clientWidth + 1);
  expect(geometry.message.width).toBeGreaterThan(0);
  expect(geometry.message.scrollWidth, 'The complete Chinese warning wraps inside its text area').toBeLessThanOrEqual(geometry.message.clientWidth + 1);
  expect(geometry.lines.length).toBeGreaterThan(0);
  for (const line of geometry.lines) {
    expect(line.left).toBeGreaterThanOrEqual(geometry.strip.left - 1);
    expect(line.right).toBeLessThanOrEqual(geometry.strip.right + 1);
  }
  for (const button of geometry.buttons) {
    expect(button.left, button.label || '').toBeGreaterThanOrEqual(geometry.strip.left - 1);
    expect(button.right, button.label || '').toBeLessThanOrEqual(geometry.strip.right + 1);
    expect(button.top, button.label || '').toBeGreaterThanOrEqual(0);
    expect(button.bottom, button.label || '').toBeLessThanOrEqual(geometry.viewport.height);
    expect(button.width, button.label || '').toBeGreaterThan(0);
    expect(button.height, button.label || '').toBeGreaterThan(0);
    expect(button.scrollWidth, `${button.label} has no clipped label`).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(button.centerReachable, `${button.label} has an unobstructed in-viewport hit target`).toBe(true);
  }
  for (const button of await strip.getByRole('button').all()) {
    await expect(button).toBeEnabled();
    await expect(button).toBeInViewport({ ratio: 1 });
  }
}

// Explicit widths run only in the three existing desktop engine projects. Do
// not multiply the larger concurrency fixture through the mobile projects.
for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  for (const choice of ['load', 'overwrite'] as const) {
    test(`${viewport.width}px conflict controls preserve and resolve ${choice} scenes`, async ({ page: newer, context }, info) => {
      test.setTimeout(60_000);
      const stale = await context.newPage();
      const staleErrors: string[] = [];
      stale.on('pageerror', error => staleErrors.push(error.message));
      try {
        for (const page of [newer, stale]) {
          await page.setViewportSize(viewport);
          await installWriteProbe(page);
          await page.clock.install();
        }
        await newer.goto('/');
        await importBook(newer);
        await expect(saved(newer)).toBeVisible();
        await pauseDebounce(newer);
        const baseline = (await snapshots(newer))[0];
        await writes(newer, true);

        await stale.goto('/');
        const recent = stale.getByRole('button', { name: /leafspace-12-pages\.pdf/ });
        await expect(recent).toBeVisible();
        await pauseDebounce(stale);
        await recent.click();
        await expect(stale.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
        await expect(reader(stale)).toBeVisible();
        expect((await snapshots(stale))[0]).toEqual(baseline);
        await arrangeScene(stale, 3, 4, true);
        await arrangeScene(newer, 7, 8);
        await expect(saved(newer)).not.toBeVisible();
        await newer.getByRole('button', { name: '保存现场', exact: true }).click();
        await expect(saved(newer)).toBeVisible();
        const durable = (await snapshots(newer))[0];
        expect(durable).not.toEqual(baseline);
        expect(durable).toMatchObject({ currentPage: 8, scale: 1, layoutPreset: 'single', heldPages: [{ pageNumber: 7 }] });

        await stale.getByRole('button', { name: '保存现场', exact: true }).click();
        await expect(conflict(stale)).toContainText('另一个标签页');
        await expect(saved(stale)).not.toBeVisible();
        // The established conflict now blocks autosaves. Resume for real fixture
        // paint and capture; only setup needed a deterministic paused debounce.
        await stale.clock.resume();
        await expectMainPage(stale, 4);
        await expectPreserved(stale, durable);
        await captureStrip(stale, conflict(stale), info, `${viewport.width}-${choice}-conflict`);

        await conflict(stale).getByRole('button', { name: '关闭提示', exact: true }).click();
        await expect(conflict(stale)).toHaveCount(0);
        await expectPreserved(stale, durable);
        await expectScene(newer, 8, 7);
        expect(await stale.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        const details = stale.getByRole('button', { name: '查看问题', exact: true });
        await expect(details).toBeFocused();
        await details.click();
        await expect(conflict(stale)).toBeFocused();

        const opener = conflict(stale).getByRole('button', { name: choice === 'load' ? '载入已存现场' : '用此页覆盖', exact: true });
        const confirm = confirmation(stale).getByRole('button', { name: choice === 'load' ? '确认载入' : '确认覆盖', exact: true });
        await opener.click();
        await expect(confirmation(stale)).toContainText('检测到的已存现场：第 8 页');
        await expect(confirmation(stale)).toContainText(choice === 'load' ? '此页更改将丢失' : '已存现场将被替换');
        await captureStrip(stale, confirmation(stale), info, `${viewport.width}-${choice}-confirmation`);
        await captureStrip(stale, conflict(stale), info, `${viewport.width}-${choice}-conflict-with-confirmation`);
        await confirmation(stale).getByRole('button', { name: '取消处理', exact: true }).click();
        await expect(confirmation(stale)).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expectPreserved(stale, durable);
        await expectScene(newer, 8, 7);
        await captureStrip(stale, conflict(stale), info, `${viewport.width}-${choice}-cancelled`);

        await opener.click();
        // These are ordinary native clicks, without force or DOM activation.
        await confirm.click();
        await expect(confirmation(stale)).toHaveCount(0);
        await expect(conflict(stale)).toHaveCount(0);
        await expect(saved(stale)).toBeVisible();
        if (choice === 'load') {
          await expectScene(stale, 8, 7);
          await expectMainPage(stale, 8);
          expect((await snapshots(stale))[0]).toEqual(durable);
          expect(await writes(stale)).toEqual({ workspaces: 0, books: 0 });
        } else {
          await expectScene(stale, 4, 3, true);
          await expectMainPage(stale, 4);
          const chosen = (await snapshots(stale))[0];
          expect(chosen).toMatchObject({ currentPage: 4, scale: 1.2, layoutPreset: 'single', heldPages: [{ pageNumber: 3 }] });
          expect(chosen.revision).not.toBe(durable.revision);
          expect(await writes(stale)).toEqual({ workspaces: 1, books: 0 });
        }
        await expectScene(newer, 8, 7);
        expect((await writes(newer)).books).toBe(0);
        expect(await stale.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await info.attach(`${viewport.width}-${choice}-resolved`, { body: await stale.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
        await info.attach(`${viewport.width}-${choice}-final-storage`, { body: JSON.stringify(await snapshots(stale), null, 2), contentType: 'application/json' });
      } finally {
        expect(staleErrors, 'No uncaught errors in the second real tab').toEqual([]);
        await stale.close();
      }
    });
  }
}
