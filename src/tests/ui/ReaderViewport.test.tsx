import type { ComponentProps } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';

const renderLifecycle = vi.hoisted(() => ({ canvasRefs: [] as ((canvas: HTMLCanvasElement | null) => void)[], callbacks: [] as (() => void)[], loads: [] as ((page: PDFPageProxy) => void)[] }));

// Exercise reader behavior against real stores without a canvas/PDF worker.
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: ({ children }: ComponentProps<'div'>) => <div>{children}</div>,
  Page: ({ pageNumber, scale, onRenderSuccess, onLoadSuccess, canvasRef }: { pageNumber: number; scale: number; canvasRef: (canvas: HTMLCanvasElement | null) => void; onRenderSuccess: () => void; onLoadSuccess: (page: PDFPageProxy) => void }) => {
    renderLifecycle.canvasRefs.push(canvasRef);
    renderLifecycle.callbacks.push(onRenderSuccess);
    renderLifecycle.loads.push(onLoadSuccess);
    return <div data-testid="pdf-page" data-page={pageNumber} data-scale={scale}><button onClick={onRenderSuccess}>Complete PDF render</button></div>;
  },
}));
vi.mock('../../services/ThumbnailService', () => ({
  thumbnailService: {
    ensureThumbnail: vi.fn().mockResolvedValue(undefined),
    getThumbnailKey: (page: number) => `test_${page}_240`,
  },
}));

function loadDocument(currentPage = 3, scale = 1) {
  useBookStore.getState().setDocumentReady({
    documentId: 'reader-test', documentUrl: 'memory://reader.pdf', totalPages: 20,
    initialPage: currentPage, scale,
  });
}

function readerRegion() {
  return screen.getByRole('region', { name: /阅读区/ });
}

function mockScrollGeometry(element: HTMLElement) {
  let width = 400, height = 300, scrollWidth = 900, scrollHeight = 1200;
  let left = element.scrollLeft, top = element.scrollTop;
  Object.defineProperties(element, {
    clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, get: () => height },
    scrollWidth: { configurable: true, get: () => scrollWidth }, scrollHeight: { configurable: true, get: () => scrollHeight },
    scrollLeft: { configurable: true, get: () => left, set: (value: number) => { left = Math.max(0, Math.min(value, scrollWidth - width)); } },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, scrollHeight - height)); } },
  });
  return (next: { width?: number; height?: number; scrollWidth?: number; scrollHeight?: number }) => {
    width = next.width ?? width; height = next.height ?? height; scrollWidth = next.scrollWidth ?? scrollWidth; scrollHeight = next.scrollHeight ?? scrollHeight;
    element.scrollLeft = left; element.scrollTop = top;
  };
}

const resizeCallbacks: (() => void)[] = [];
describe('ReaderViewport', () => {
  beforeEach(() => {
    renderLifecycle.canvasRefs.length = 0;
    renderLifecycle.callbacks.length = 0;
    renderLifecycle.loads.length = 0;
    resizeCallbacks.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resizeCallbacks.push(callback); }
      observe() {}
      disconnect() {}
    });
    useBookStore.getState().reset();
    heldStore.getState().reset();
    windowStore.getState().reset();
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows the waiting state before a document is loaded', () => {
    render(<ReaderViewport isMain windowId="main" />);
    expect(screen.getByText('等待载入...')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-page')).not.toBeInTheDocument();
  });

  it('initializes PDF canvas context hints before drawing and keeps the ref stable during zoom', () => {
    loadDocument();
    render(<ReaderViewport isMain windowId="main" />);
    const initialize = renderLifecycle.canvasRefs.at(-1)!;
    const getContext = vi.fn();
    initialize({ getContext } as unknown as HTMLCanvasElement);
    expect(getContext).toHaveBeenCalledExactlyOnceWith('2d', { alpha: false, willReadFrequently: true });
    expect(() => initialize(null)).not.toThrow();
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(renderLifecycle.canvasRefs.at(-1)).toBe(initialize);
  });

  it('uses bookStore as the source of the main page and scale', () => {
    loadDocument(7, 1.5);
    render(<ReaderViewport pageNumber={1} isMain windowId="main" />);
    expect(screen.getByText('主视角')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '7');
    expect(screen.getByText('150%')).toBeInTheDocument();
    act(() => useBookStore.getState().setCurrentPage(12));
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '12');
  });

  it.each([
    ['放大', 1.2, '120%'],
    ['缩小', 0.8, '80%'],
  ] as const)('persists main-reader %s through bookStore', (name, scale, label) => {
    loadDocument();
    render(<ReaderViewport isMain windowId="main" />);
    fireEvent.click(screen.getByRole('button', { name }));
    expect(useBookStore.getState().scale).toBeCloseTo(scale);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(windowStore.getState().windows[0].viewport?.scale).toBeCloseTo(scale);
  });

  it('keeps reference zoom independent of the main-reader scale', () => {
    loadDocument(3, 1.5);
    const id = windowStore.getState().openInNewWindow(8);
    windowStore.getState().updateWindow(id, { viewport: { scale: 2, mode: 'pointer' } });
    render(<ReaderViewport pageNumber={8} windowId={id} />);
    expect(screen.getByText('参考 P.8')).toBeInTheDocument();
    expect(screen.getByText('200%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(screen.getByText('240%')).toBeInTheDocument();
    expect(useBookStore.getState().scale).toBe(1.5);
    expect(windowStore.getState().windows.find(window => window.id === id)?.viewport?.scale).toBeCloseTo(2.4);
  });

  it('changes and restores the interaction mode', () => {
    loadDocument();
    const first = render(<ReaderViewport isMain windowId="main" />);
    fireEvent.click(screen.getByRole('button', { name: '选择文字' }));
    expect(screen.getByRole('button', { name: '选择文字' })).toHaveAttribute('aria-pressed', 'true');
    expect(windowStore.getState().windows[0].viewport?.mode).toBe('pointer');
    first.unmount();
    render(<ReaderViewport isMain windowId="main" />);
    expect(screen.getByRole('button', { name: '选择文字' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clamps keyboard navigation at the document boundaries and ignores modified shortcuts', () => {
    loadDocument(1);
    render(<ReaderViewport isMain windowId="main" />);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowLeft' });
    expect(useBookStore.getState().currentPage).toBe(1);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight', ctrlKey: true });
    expect(useBookStore.getState().currentPage).toBe(1);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight' });
    expect(useBookStore.getState().currentPage).toBe(2);
    act(() => useBookStore.getState().setCurrentPage(20));
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight' });
    expect(useBookStore.getState().currentPage).toBe(20);
  });

  it('navigates a reference window without changing the main page and activates it on focus', () => {
    loadDocument(3);
    const id = windowStore.getState().openInNewWindow(8);
    windowStore.getState().setActiveWindow('main');
    render(<ReaderViewport pageNumber={8} windowId={id} />);
    fireEvent.focus(readerRegion());
    expect(windowStore.getState().activeWindowId).toBe(id);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight' });
    expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(9);
    expect(useBookStore.getState().currentPage).toBe(3);
  });

  it('holds the active page with ArrowUp without creating duplicate held pages', async () => {
    loadDocument(6);
    render(<ReaderViewport isMain windowId="main" />);
    await act(async () => {
      fireEvent.keyDown(readerRegion(), { key: 'ArrowUp' });
      fireEvent.keyDown(readerRegion(), { key: 'ArrowUp' });
    });
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([6]);
  });

  it('allows normal wheel scrolling and reserves zoom for Ctrl or Meta + wheel', () => {
    loadDocument();
    render(<ReaderViewport isMain windowId="main" />);
    const normalScroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    fireEvent(readerRegion(), normalScroll);
    expect(normalScroll.defaultPrevented).toBe(false);
    expect(useBookStore.getState().scale).toBe(1);
    fireEvent.wheel(readerRegion(), { deltaY: -100, ctrlKey: true });
    expect(useBookStore.getState().scale).toBeGreaterThan(1);
  });

  it('restores and persists viewport scroll offsets after PDF rendering', async () => {
    loadDocument();
    windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 120, scrollTop: 240 } });
    render(<ReaderViewport isMain windowId="main" />);
    expect(readerRegion().scrollLeft).toBe(120);
    expect(readerRegion().scrollTop).toBe(240);
    Object.defineProperty(readerRegion(), 'clientWidth', { value: 400 });
    Object.defineProperty(readerRegion(), 'clientHeight', { value: 600 });
    fireEvent.click(screen.getByRole('button', { name: 'Complete PDF render' }));
    await waitFor(() => {
      fireEvent.scroll(readerRegion(), { target: { scrollLeft: 150, scrollTop: 320 } });
      expect(windowStore.getState().windows[0].viewport?.scrollTop).toBe(320);
    });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 320 });
  });

  it('preserves one scroll delivered after zoom geometry but before PDF paint', async () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    mockScrollGeometry(readerRegion());
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('button', { name: '放大' }));
    fireEvent.scroll(readerRegion(), { target: { scrollLeft: 150, scrollTop: 300 } });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 300 });
    fireEvent.click(screen.getByRole('button', { name: 'Complete PDF render' }));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(readerRegion().scrollTop).toBe(300);
    expect(readerRegion().scrollLeft).toBe(150);
  });

  it('captures a scroll before ResizeObserver can restore over its queued event', () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    mockScrollGeometry(readerRegion());
    readerRegion().scrollLeft = 150; readerRegion().scrollTop = 300;
    act(() => resizeCallbacks.forEach(callback => callback()));
    expect(readerRegion().scrollTop).toBe(300);
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 300 });
  });

  it('retains restore targets across geometry collapse and rapid scale/mode changes', () => {
    loadDocument(); windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 150, scrollTop: 300 } });
    render(<ReaderViewport isMain windowId="main" />);
    const geometry = mockScrollGeometry(readerRegion());
    geometry({ scrollWidth: 400, scrollHeight: 300 });
    fireEvent.scroll(readerRegion());
    fireEvent.click(screen.getByRole('button', { name: '选择文字' }));
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 300 });
    geometry({ scrollWidth: 900, scrollHeight: 1200 });
    act(() => resizeCallbacks.forEach(callback => callback()));
    expect(readerRegion().scrollLeft).toBe(150); expect(readerRegion().scrollTop).toBe(300);
  });

  it('accepts vertical intent while preserving a temporarily clamped horizontal target, then a real return to zero', () => {
    loadDocument(); windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 150, scrollTop: 300 } });
    render(<ReaderViewport isMain windowId="main" />);
    const geometry = mockScrollGeometry(readerRegion());
    geometry({ scrollWidth: 400 });
    fireEvent.scroll(readerRegion(), { target: { scrollTop: 200 } });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 200 });
    geometry({ scrollWidth: 900 }); act(() => resizeCallbacks.forEach(callback => callback()));
    fireEvent.scroll(readerRegion(), { target: { scrollTop: 0, scrollLeft: 0 } });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 0, scrollTop: 0 });
  });

  it('retains hidden-pane offsets and restores them when visible again', () => {
    loadDocument(); windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 150, scrollTop: 300 } });
    render(<ReaderViewport isMain windowId="main" />);
    const geometry = mockScrollGeometry(readerRegion());
    geometry({ width: 0, height: 0, scrollWidth: 0, scrollHeight: 0 });
    fireEvent.scroll(readerRegion()); act(() => resizeCallbacks.forEach(callback => callback()));
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 300 });
    geometry({ width: 400, height: 300, scrollWidth: 900, scrollHeight: 1200 });
    act(() => resizeCallbacks.forEach(callback => callback()));
    expect(readerRegion().scrollLeft).toBe(150); expect(readerRegion().scrollTop).toBe(300);
  });

  it('does not reinterpret old-paper DOM movement as the restored page position', () => {
    loadDocument(3);
    render(<ReaderViewport isMain windowId="main" />);
    mockScrollGeometry(readerRegion());
    act(() => windowStore.getState().updateWindow('main', { pageNumber: 8 }));
    const stale = renderLifecycle.callbacks.at(-1)!;
    // The old paper moved/clamped before its queued scroll event was delivered.
    readerRegion().scrollLeft = 50; readerRegion().scrollTop = 70;
    act(() => windowStore.getState().restoreWindowPosition('main', {
      pageNumber: 3, title: '第 3 页', viewport: { scrollLeft: 150, scrollTop: 300, scale: 1, mode: 'grab' },
    }));
    expect(readerRegion().scrollLeft).toBe(150); expect(readerRegion().scrollTop).toBe(300);
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 300 });
    act(() => stale());
    fireEvent.scroll(readerRegion(), { target: { scrollLeft: 90, scrollTop: 200 } });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 90, scrollTop: 200 });
  });

  it('ignores stale PDF completion callbacks after scale changes and cancels queued frames', () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    const stale = renderLifecycle.callbacks.at(-1)!;
    const schedule = vi.spyOn(window, 'requestAnimationFrame');
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    schedule.mockClear(); act(() => stale());
    expect(schedule).not.toHaveBeenCalled();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    fireEvent.click(screen.getByRole('button', { name: 'Complete PDF render' }));
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(cancel).toHaveBeenCalled();
  });

  it('does not persist hidden zero geometry when a pending zoom render completes', async () => {
    loadDocument(); windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 150, scrollTop: 300 } });
    render(<ReaderViewport isMain windowId="main" />);
    const geometry = mockScrollGeometry(readerRegion());
    fireEvent.wheel(readerRegion(), { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 150 });
    geometry({ width: 0, height: 0, scrollWidth: 0, scrollHeight: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Complete PDF render' }));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 300 });
    geometry({ width: 400, height: 300, scrollWidth: 900, scrollHeight: 1200 });
    act(() => resizeCallbacks.forEach(callback => callback()));
    expect(readerRegion().scrollLeft).toBe(150); expect(readerRegion().scrollTop).toBe(300);
  });

  it('rejects an old render completion after scale changes away and back', () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    const stale = renderLifecycle.callbacks.at(-1)!;
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复适合宽度' }));
    const schedule = vi.spyOn(window, 'requestAnimationFrame');
    act(() => stale());
    expect(schedule).not.toHaveBeenCalled();
  });

  it('captures an undelivered scroll before creating the next wheel zoom anchor', async () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    const region = readerRegion(); mockScrollGeometry(region);
    const frame = region.querySelector<HTMLElement>('.w-max')!;
    vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 400, 300));
    vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40 - region.scrollLeft, 40 - region.scrollTop, 612, 792));
    region.scrollLeft = 100; region.scrollTop = 200;
    fireEvent.wheel(region, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 150 });
    fireEvent.click(screen.getByRole('button', { name: 'Complete PDF render' }));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(region.scrollLeft).toBeCloseTo(139);
    expect(region.scrollTop).toBeCloseTo(246.5);
  });

  it('reserves paper geometry and anchors toolbar zoom before paint even when a scrollbar reduces the viewport', () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    const region = readerRegion(); mockScrollGeometry(region);
    act(() => resizeCallbacks.forEach(callback => callback()));
    act(() => renderLifecycle.loads.at(-1)!({ pageNumber: 3, getViewport: () => ({ width: 612, height: 792 }) } as unknown as PDFPageProxy));
    const frame = region.querySelector<HTMLElement>('.w-max')!;
    vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 400, 300));
    vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40 - region.scrollLeft, 60 - region.scrollTop, parseFloat(frame.style.width), parseFloat(frame.style.height)));
    fireEvent.scroll(region, { target: { scrollLeft: 150, scrollTop: 300 } });
    const width = parseFloat(frame.style.width);
    Object.defineProperty(region, 'clientHeight', { configurable: true, get: () => useBookStore.getState().scale > 1 ? 292 : 300 });
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(parseFloat(frame.style.width)).toBe(Math.floor((width - 2) * 1.2) + 2);
    expect(region.scrollLeft).toBeCloseTo(212);
    expect(region.scrollTop).toBeCloseTo(382);
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 212, scrollTop: 382 });
  });

  it('accumulates a wheel burst before React commits without replacing its original anchor', () => {
    loadDocument(); render(<ReaderViewport isMain windowId="main" />);
    const region = readerRegion(); mockScrollGeometry(region);
    act(() => resizeCallbacks.forEach(callback => callback()));
    act(() => renderLifecycle.loads.at(-1)!({ pageNumber: 3, getViewport: () => ({ width: 612, height: 792 }) } as unknown as PDFPageProxy));
    const frame = region.querySelector<HTMLElement>('.w-max')!;
    vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 400, 300));
    vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40 - region.scrollLeft, 60 - region.scrollTop, parseFloat(frame.style.width), parseFloat(frame.style.height)));
    fireEvent.scroll(region, { target: { scrollLeft: 100, scrollTop: 200 } });
    act(() => {
      for (let i = 0; i < 3; i++) region.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120, clientX: 200, clientY: 150 }));
    });
    expect(useBookStore.getState().scale).toBeCloseTo(1.15 ** 3);
    expect(region.scrollLeft).toBeCloseTo(100 + 260 * (1.15 ** 3 - 1));
    expect(region.scrollTop).toBeCloseTo(200 + 290 * (1.15 ** 3 - 1));
  });

  it.each([[4, '放大'], [0.1, '缩小']] as const)('disables %s-scale zoom at the supported boundary', (scale, name) => {
    loadDocument(3, scale);
    render(<ReaderViewport isMain windowId="main" />);
    expect(screen.getByRole('button', { name })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name }));
    expect(useBookStore.getState().scale).toBe(scale);
  });

});
