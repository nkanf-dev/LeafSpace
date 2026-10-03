import type { ComponentProps } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';

const lifecycle = vi.hoisted(() => ({ load: null as null | ((page: PDFPageProxy) => void), complete: null as null | (() => void) }));
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: ({ children }: ComponentProps<'div'>) => <div>{children}</div>,
  Page: ({ onLoadSuccess, onRenderSuccess }: { onLoadSuccess: (page: PDFPageProxy) => void; onRenderSuccess: () => void }) => {
    lifecycle.load = onLoadSuccess; lifecycle.complete = onRenderSuccess;
    return <canvas className="react-pdf__Page__canvas" />;
  },
}));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn() } }));

const resizeCallbacks: (() => void)[] = [];
let frames = new Map<number, FrameRequestCallback>(), nextFrame = 0;
function flushFrames() {
  act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0)); });
}
function setup({ mobile = false, scale = 1, integer = true } = {}) {
  vi.stubGlobal('innerWidth', mobile ? 390 : 1280);
  useBookStore.getState().setDocumentReady({ documentId: 'precision', documentUrl: 'memory://precision.pdf', totalPages: 10, initialPage: 9, scale });
  render(<ReaderViewport isMain windowId="main" />);
  const region = screen.getByRole('region', { name: '主阅读区' });
  const frame = region.querySelector<HTMLElement>('.w-max')!;
  const canvas = region.querySelector('canvas')!;
  const width = mobile ? 390 : 800, height = mobile ? 600 : 670;
  const base = mobile ? 356 : 612, dpr = mobile ? 2.625 : 1;
  let left = 0, top = 0, renderedScale = scale;
  const canvasSize = () => {
    const pixelWidth = Math.floor(base * renderedScale * dpr);
    const pixelHeight = Math.floor(base * renderedScale * 6 * dpr);
    const cssWidth = Math.floor(base * renderedScale);
    return { width: cssWidth, height: Math.round(cssWidth * pixelHeight / pixelWidth * 64) / 64 };
  };
  Object.defineProperties(region, {
    clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, get: () => height },
    scrollWidth: { configurable: true, get: () => Math.max(width, parseFloat(frame.style.width) + (mobile ? 32 : 80)) },
    scrollHeight: { configurable: true, get: () => Math.max(height, parseFloat(frame.style.height) + 120) },
    scrollLeft: { configurable: true, get: () => left, set: (value: number) => { left = Math.max(0, Math.min(integer ? Math.round(value) : value, region.scrollWidth - width)); } },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(integer ? Math.round(value) : value, region.scrollHeight - height)); } },
  });
  vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, height));
  const frameLeft = () => Math.max(mobile ? 16 : 40, (width - parseFloat(frame.style.width)) / 2) - left;
  vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => new DOMRect(frameLeft(), 60 - top, parseFloat(frame.style.width), parseFloat(frame.style.height)));
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => new DOMRect(frameLeft() + 1, 61 - top, canvasSize().width, canvasSize().height));
  act(() => resizeCallbacks.forEach(callback => callback()));
  act(() => lifecycle.load!({ pageNumber: 9, getViewport: () => ({ width: 200, height: 1200 }) } as unknown as PDFPageProxy));
  const paint = () => { renderedScale = useBookStore.getState().scale; act(() => lifecycle.complete!()); flushFrames(); };
  paint();
  const point = () => {
    const box = canvas.getBoundingClientRect();
    return { x: (width / 2 - box.left) / box.width, y: (height / 2 - box.top) / box.height };
  };
  const error = (anchor: ReturnType<typeof point>) => {
    const after = point(), box = canvas.getBoundingClientRect();
    // Normalize only IEEE arithmetic dust; the paper-point limit remains 2 CSS px.
    return { x: Math.round(Math.abs(after.x - anchor.x) * box.width * 1e6) / 1e6, y: Math.round(Math.abs(after.y - anchor.y) * box.height * 1e6) / 1e6 };
  };
  const scroll = (offset: number, deliver = true) => {
    region.scrollTop = offset;
    if (deliver) fireEvent.scroll(region);
  };
  return { region, frame, canvas, paint, point, error, scroll, setRenderedScale: (value: number) => { renderedScale = value; } };
}

describe('reader paper-point precision and ownership', () => {
  beforeEach(() => {
    useBookStore.getState().reset(); windowStore.getState().reset();
    resizeCallbacks.length = 0; frames = new Map(); nextFrame = 0;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} disconnect() {} });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([false, true])('retains the original tall-page point through every increase to 400% (mobile %s)', mobile => {
    const view = setup({ mobile });
    const anchor = view.point();
    while (useBookStore.getState().scale < 4) {
      fireEvent.click(screen.getByRole('button', { name: '放大' })); view.paint();
      expect(view.error(anchor).x).toBeLessThanOrEqual(2);
      expect(view.error(anchor).y).toBeLessThanOrEqual(2);
    }
    expect(useBookStore.getState().scale).toBe(4);
  });

  it('corrects a deep fractional-DPR point against completed canvas geometry', () => {
    const view = setup({ mobile: true, scale: 1.2 ** 4, integer: false });
    view.scroll(view.canvas.getBoundingClientRect().height * 0.85 + 61 - 300);
    const anchor = view.point();
    fireEvent.click(screen.getByRole('button', { name: '放大' })); view.paint();
    expect(view.error(anchor).y).toBeLessThanOrEqual(2);
  });

  it('preserves a deep fractional-DPR pinch source at the moved midpoint', () => {
    const view = setup({ mobile: true, scale: 1.2 ** 4, integer: false });
    view.scroll(view.canvas.getBoundingClientRect().height * 0.85 + 61 - 300);
    const source = view.point();
    const touch = (id: number, x: number, y: number) => ({ identifier: id, clientX: x, clientY: y, target: view.canvas });
    fireEvent.touchStart(view.region, { touches: [touch(1, 145, 300), touch(2, 245, 300)] });
    fireEvent.touchMove(view.region, { touches: [touch(1, 145, 330), touch(2, 265, 330)] });
    expect(view.frame.style.transform).toContain('scale(1.2)');
    fireEvent.touchEnd(view.region, { touches: [], changedTouches: [touch(1, 145, 330), touch(2, 265, 330)] });
    view.paint();
    const paper = view.canvas.getBoundingClientRect();
    expect(Math.abs(paper.left + source.x * paper.width - 205)).toBeLessThanOrEqual(2);
    expect(Math.abs(paper.top + source.y * paper.height - 330)).toBeLessThanOrEqual(2);
    expect(view.frame.style.transform).toBe('');
  });

  it.each(['scroll', 'undelivered scroll', 'pan start', 'touch start', 'external restore', 'fit reset'])('does not let a pending canvas correction override %s', kind => {
    const view = setup({ mobile: true, scale: 1.2 ** 4, integer: false });
    view.scroll(3400);
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    if (kind.includes('scroll')) view.scroll(3500, kind !== 'undelivered scroll');
    else if (kind === 'pan start') fireEvent.mouseDown(view.region, { button: 0, clientX: 200, clientY: 300 });
    else if (kind === 'touch start') fireEvent.touchStart(view.region, { touches: [{ identifier: 1, clientX: 200, clientY: 300, target: view.canvas }] });
    else if (kind === 'external restore') act(() => windowStore.getState().updateWindow('main', { viewport: { ...windowStore.getState().windows[0].viewport, scrollTop: 3500 } }));
    else fireEvent.click(screen.getByRole('button', { name: '恢复适合宽度' }));
    const expected = kind === 'external restore' ? 3500 : view.region.scrollTop;
    view.paint();
    expect(view.region.scrollTop).toBeCloseTo(expected, 6);
  });

  it('keeps vertical precision when a fixed wheel pivot repeatedly clamps horizontally', () => {
    const view = setup();
    const anchor = view.point();
    while (useBookStore.getState().scale < 4) {
      fireEvent.wheel(view.region, { ctrlKey: true, deltaY: -100, clientX: 0, clientY: 335 }); view.paint();
      expect(view.region.scrollLeft).toBe(0);
      expect(view.error(anchor).y).toBeLessThanOrEqual(2);
    }
  });

  it('rebases the clamped paper axis before reversing zoom direction', () => {
    const view = setup({ mobile: true, integer: false });
    fireEvent.click(screen.getByRole('button', { name: '缩小' })); view.paint();
    expect(view.region.scrollTop).toBe(0);
    const anchor = view.point();
    fireEvent.click(screen.getByRole('button', { name: '放大' })); view.paint();
    expect(view.error(anchor).y).toBeLessThanOrEqual(2);
  });

  it.each(['callback', 'queued frame'])('rejects an old %s if a newer zoom is requested before React commits', kind => {
    const view = setup({ mobile: true, scale: 1.2 ** 4, integer: false });
    view.scroll(3400);
    const stale = lifecycle.complete!;
    if (kind === 'queued frame') act(() => stale());
    const queued = [...frames.values()]; frames.clear();
    const schedule = vi.mocked(window.requestAnimationFrame); schedule.mockClear();
    const before = view.region.scrollTop;
    const viewport = windowStore.getState().windows[0].viewport;
    act(() => {
      view.region.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: 200, clientY: 300 }));
      const latestViewport = windowStore.getState().windows[0].viewport;
      if (kind === 'callback') stale(); else queued.forEach(callback => callback(0));
      expect(windowStore.getState().windows[0].viewport).toBe(latestViewport);
      expect(schedule).not.toHaveBeenCalled();
      expect(view.region.scrollTop).toBe(before);
      expect(windowStore.getState().windows[0].viewport?.scrollTop).toBe(viewport?.scrollTop);
    });
    view.paint();
    expect(view.region.scrollTop).toBeGreaterThan(3900);
  });
});
